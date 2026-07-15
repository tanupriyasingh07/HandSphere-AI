/**
 * burst.ts
 * One-shot radial particle burst fired when a pinch gesture starts.
 *
 * Completely self-contained: own GLSL program, VBO, VAO, and state.
 * The existing sphere renderer (particle.ts) is not modified beyond its
 * colour/glow uniforms.
 *
 * How it works:
 *  - 200 random unit-sphere directions are generated once on the CPU and
 *    uploaded to a STATIC_DRAW VBO — they never change.
 *  - triggerBurst(t) records the start time.
 *  - draw(t, …) computes age = (t - start) / BURST_DURATION and sets uniforms.
 *  - The vertex shader drives position via ease-out quadratic:
 *      dist = age * (2 - age) * 0.50   (fast start, decelerates, max 0.50 NDC)
 *  - Point size shrinks linearly from 22px → 0 so particles vanish cleanly.
 *  - The fragment shader fades alpha as (1 - age²), matching the ease-out curve.
 *  - Blending uses the same SRC_ALPHA / ONE (additive) already set by particle.ts.
 */

import { type AnyGL }                from './webgl';
import { createProgram, getUniform } from './program';

// ── Constants ──────────────────────────────────────────────────────────────────

const BURST_COUNT = 200; // point sprites per burst

export const BURST_DURATION = 0.50; // seconds until burst is fully faded

// ── Shaders ───────────────────────────────────────────────────────────────────

const BURST_VERT = /* glsl */ `#version 300 es

in vec3 a_bDirection;    // fixed random unit-sphere direction (never changes)

uniform float u_burstAge;    // 0.0 (just triggered) → 1.0 (fully expanded)
uniform vec2  u_burstOffset; // NDC position of the sphere centre (palm offset)

out float v_bAge;

void main() {
  // Ease-out quadratic: fast departure, decelerates to rest at max travel.
  // age * (2 - age) gives 0 at age=0, 1 at age=1, with positive first-derivative.
  float dist = u_burstAge * (2.0 - u_burstAge) * 0.50;

  // Burst particles travel in their fixed radial direction from the sphere centre.
  // Only XY used for screen-space position; Z discarded (burst has no perspective).
  gl_Position  = vec4(a_bDirection.xy * dist + u_burstOffset, 0.0, 1.0);

  // Shrink from 22 px → 0 as the burst ages, so particles disappear cleanly.
  gl_PointSize = 22.0 * (1.0 - u_burstAge);

  v_bAge = u_burstAge;
}
`;

const BURST_FRAG = /* glsl */ `#version 300 es
precision highp float;

in float v_bAge;

uniform vec3 u_burstColor; // same warm-gold tint as the sphere during pinch

out vec4 fragColor;

void main() {
  // Circular clip — same pattern as the sphere particle sprite.
  vec2  uv = gl_PointCoord * 2.0 - 1.0;
  float d  = length(uv);
  if (d > 1.0) discard;

  float core = exp(-d * d * 18.0);
  float halo = exp(-d * d *  5.0) * 0.18;

  // Quadratic fade-out: alpha drops slowly at first then rapidly at the end,
  // complementing the ease-out travel curve.
  float alpha = (core + halo) * (1.0 - v_bAge * v_bAge);

  // Premultiplied-alpha tinted by u_burstColor, compatible with additive blend.
  fragColor = vec4(alpha * u_burstColor, alpha);
}
`;

// ── Public interface ───────────────────────────────────────────────────────────

export interface BurstRenderer {
  /** Record the current time so the burst animation starts from t = 0. */
  triggerBurst(timeSec: number): void;
  /** Draw burst particles for this frame. No-op if no burst is active. */
  draw(timeSec: number, offsetX: number, offsetY: number, color: [number, number, number]): void;
  /** Release all GPU resources. Call on unmount or context loss. */
  dispose(): void;
}

// ── Geometry helper ────────────────────────────────────────────────────────────

/** 200 random unit-sphere directions with a fixed seed → deterministic. */
function buildBurstDirections(): Float32Array {
  const data = new Float32Array(BURST_COUNT * 3);
  let s = 99; // different seed from particle cluster (seed 42)
  const rng = () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  for (let i = 0; i < BURST_COUNT; i++) {
    const theta = Math.acos(2 * rng() - 1);
    const phi   = 2 * Math.PI * rng();
    data[i * 3    ] = Math.sin(theta) * Math.cos(phi);
    data[i * 3 + 1] = Math.sin(theta) * Math.sin(phi);
    data[i * 3 + 2] = Math.cos(theta);
  }
  return data;
}

// ── Factory ────────────────────────────────────────────────────────────────────

export function createBurstRenderer(gl: AnyGL): BurstRenderer | null {
  const gl2 = gl as WebGL2RenderingContext;

  // ── Program ──────────────────────────────────────────────────────────────
  const program = createProgram(gl, BURST_VERT, BURST_FRAG);
  if (!program) return null;

  const aDir = gl.getAttribLocation(program, 'a_bDirection');
  if (aDir < 0) {
    console.error('[burst] a_bDirection attribute not found.');
    gl.deleteProgram(program);
    return null;
  }

  // ── Uniforms ─────────────────────────────────────────────────────────────
  const uBurstAge    = getUniform(gl, program, 'u_burstAge');
  const uBurstOffset = getUniform(gl, program, 'u_burstOffset');
  const uBurstColor  = getUniform(gl, program, 'u_burstColor');

  // ── VBO — static direction vectors ───────────────────────────────────────
  const dirs = buildBurstDirections();
  const vbo  = gl.createBuffer();
  if (!vbo) { gl.deleteProgram(program); return null; }

  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, dirs, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  // ── VAO ───────────────────────────────────────────────────────────────────
  const vao = gl2.createVertexArray();
  if (!vao) { gl.deleteProgram(program); gl.deleteBuffer(vbo); return null; }

  gl2.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.vertexAttribPointer(aDir, 3, gl.FLOAT, false, 12, 0);
  gl.enableVertexAttribArray(aDir);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl2.bindVertexArray(null);

  // Ensure additive blending is active (particle.ts sets this, but be explicit).
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

  // ── Burst state ───────────────────────────────────────────────────────────
  let burstStartTime: number | null = null;

  // ── Public API ────────────────────────────────────────────────────────────

  function triggerBurst(timeSec: number): void {
    burstStartTime = timeSec;
  }

  function draw(
    timeSec: number,
    offsetX: number,
    offsetY: number,
    color: [number, number, number],
  ): void {
    if (burstStartTime === null) return;

    const age = (timeSec - burstStartTime) / BURST_DURATION;
    if (age >= 1.0) {
      burstStartTime = null; // burst finished — stop drawing
      return;
    }

    gl.useProgram(program);

    if (uBurstAge)    gl.uniform1f(uBurstAge,    age);
    if (uBurstOffset) gl.uniform2f(uBurstOffset, offsetX, offsetY);
    if (uBurstColor)  gl.uniform3fv(uBurstColor, color);

    gl2.bindVertexArray(vao);
    gl.drawArrays(gl.POINTS, 0, BURST_COUNT);
    gl2.bindVertexArray(null);

    gl.useProgram(null);
  }

  function dispose(): void {
    gl2.deleteVertexArray(vao);
    gl.deleteBuffer(vbo);
    gl.deleteProgram(program);
  }

  return { triggerBurst, draw, dispose };
}
