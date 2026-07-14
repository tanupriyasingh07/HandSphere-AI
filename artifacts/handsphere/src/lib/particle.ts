/**
 * particle.ts
 * Creates and draws 1000 glowing particles distributed in a spherical volume
 * around the clip-space origin, with slow per-particle float drift.
 *
 * Design notes:
 *  - All 1000 points are issued in ONE draw call: gl.drawArrays(gl.POINTS, 0, 1000).
 *  - Geometry lives in a single interleaved VBO: [x, y, z, phase] per vertex.
 *    Stride = 16 bytes (4 floats).  a_position at offset 0, a_phase at offset 12.
 *  - Positions are generated on the CPU once at init, then uploaded to the GPU.
 *  - Volume distribution: r = R * (MIN_FILL + (1−MIN_FILL) * ∛rand).
 *    Cube-root sampling makes density uniform in volume while the MIN_FILL
 *    floor keeps particles away from the very centre, preserving a visible
 *    spherical shape and adding natural depth variation.
 *  - Animation (slow float drift) is computed entirely in the vertex shader
 *    via u_time — the VBO never changes after upload.
 *  - Additive blending (SRC_ALPHA, ONE) accumulates light; no alpha sorting needed.
 */

import { type AnyGL }                    from './webgl';
import { createProgram, getUniform }     from './program';
import { PARTICLE_VERT, PARTICLE_FRAG }  from './shaders';

// ── Constants ─────────────────────────────────────────────────────────────────

const PARTICLE_COUNT = 1000;

// Point-sprite canvas size in pixels.
// Must be small enough that 1000 additive halos don't merge into a blob.
// 14 px gives a visible core (~2 px) plus a contained glow ring.
const SPRITE_SIZE = 14;

// Outer sphere radius in NDC units.
const SPHERE_RADIUS = 0.18;

// Minimum fractional radius (0–1).  Particles live between MIN_FILL and 1.0
// of SPHERE_RADIUS, giving a visible surface density with interior depth.
const MIN_FILL = 0.30;

// Floats per vertex in the interleaved VBO: x, y, z, phase.
const FLOATS_PER_VERTEX = 4;

// ── Geometry helpers ──────────────────────────────────────────────────────────

/** Seeded LCG pseudo-random — deterministic across reloads. */
function makePRNG(seed: number) {
  let s = seed;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/**
 * Generates `count` positions distributed uniformly inside a spherical volume.
 *
 * Direction: uniform on the sphere surface via the trig method.
 *   theta = acos(2u − 1),  phi = 2π·v
 *
 * Radius: r = R · (MIN_FILL + (1 − MIN_FILL) · ∛rand)
 *   ∛rand corrects the bias toward the centre that plain rand() would cause
 *   (volume of a shell ∝ r², so the inverse CDF is the cube root).
 *   MIN_FILL prevents particles collapsing into a dot at the origin.
 *
 * Returns an interleaved Float32Array: [x, y, z, phase,  x, y, z, phase, …]
 */
function buildCluster(count: number): Float32Array {
  const data = new Float32Array(count * FLOATS_PER_VERTEX);
  const rand = makePRNG(42); // fixed seed → consistent appearance on reload

  for (let i = 0; i < count; i++) {
    // ── Direction (uniform on sphere surface) ───────────────────────────
    const u     = rand();
    const v     = rand();
    const theta = Math.acos(2 * u - 1);      // polar angle
    const phi   = 2 * Math.PI * v;           // azimuth angle

    // ── Radius (uniform volume, floored at MIN_FILL) ────────────────────
    const t = rand();
    const r = SPHERE_RADIUS * (MIN_FILL + (1 - MIN_FILL) * Math.cbrt(t));

    const base = i * FLOATS_PER_VERTEX;
    data[base    ] = Math.sin(theta) * Math.cos(phi) * r; // x
    data[base + 1] = Math.sin(theta) * Math.sin(phi) * r; // y  (depth on screen)
    data[base + 2] = Math.cos(theta)                 * r; // z  (left–right tilt)
    data[base + 3] = rand() * Math.PI * 2;                // phase [0, 2π]
  }

  return data;
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface ParticleRenderer {
  /** Draw one frame. Call every rAF tick after clearFrame(). */
  draw(timeSeconds: number): void;
  /** Release all GPU resources. Call on unmount or context loss. */
  dispose(): void;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Compiles the shader program, uploads cluster geometry to a VBO,
 * configures the VAO, and returns draw / dispose closures.
 * Returns null if any GPU resource creation fails.
 */
export function createParticleRenderer(gl: AnyGL): ParticleRenderer | null {
  const gl2 = gl as WebGL2RenderingContext;

  // ── Shader program ────────────────────────────────────────────────────────
  const program = createProgram(gl, PARTICLE_VERT, PARTICLE_FRAG);
  if (!program) return null;

  // ── Attribute locations ───────────────────────────────────────────────────
  const aPosition = gl.getAttribLocation(program, 'a_position');
  const aPhase    = gl.getAttribLocation(program, 'a_phase');

  if (aPosition < 0 || aPhase < 0) {
    console.error('[particle] Attribute location not found — check shader source.');
    gl.deleteProgram(program);
    return null;
  }

  // ── Uniform locations ─────────────────────────────────────────────────────
  const uTime      = getUniform(gl, program, 'u_time');
  const uPointSize = getUniform(gl, program, 'u_pointSize');

  // ── VBO — interleaved cluster geometry ───────────────────────────────────
  const clusterData = buildCluster(PARTICLE_COUNT);

  const vbo = gl.createBuffer();
  if (!vbo) { gl.deleteProgram(program); return null; }

  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, clusterData, gl.STATIC_DRAW); // upload once, never update
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  // ── VAO — attribute layout ────────────────────────────────────────────────
  const vao = gl2.createVertexArray();
  if (!vao) { gl.deleteProgram(program); gl.deleteBuffer(vbo); return null; }

  gl2.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);

  const stride = FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT; // 16 bytes

  // a_position: 3 floats starting at byte 0
  gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(aPosition);

  // a_phase: 1 float starting at byte 12
  const phaseOffset = 3 * Float32Array.BYTES_PER_ELEMENT;
  gl.vertexAttribPointer(aPhase, 1, gl.FLOAT, false, stride, phaseOffset);
  gl.enableVertexAttribArray(aPhase);

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl2.bindVertexArray(null);

  // ── Blending ──────────────────────────────────────────────────────────────
  // Additive: each fragment adds its brightness to the framebuffer.
  // Overlapping halos accumulate into a natural bloom without sorting.
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

  // ── Draw ──────────────────────────────────────────────────────────────────
  function draw(timeSeconds: number): void {
    gl.useProgram(program);

    if (uTime)      gl.uniform1f(uTime,      timeSeconds);
    if (uPointSize) gl.uniform1f(uPointSize, SPRITE_SIZE);

    gl2.bindVertexArray(vao);

    // Single draw call — all 1000 particles, all geometry on the GPU.
    gl.drawArrays(gl.POINTS, 0, PARTICLE_COUNT);

    gl2.bindVertexArray(null);
    gl.useProgram(null);
  }

  // ── Dispose ───────────────────────────────────────────────────────────────
  function dispose(): void {
    gl2.deleteVertexArray(vao);
    gl.deleteBuffer(vbo);
    gl.deleteProgram(program);
    gl.disable(gl.BLEND);
  }

  return { draw, dispose };
}
