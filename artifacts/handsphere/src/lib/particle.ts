/**
 * particle.ts
 * Creates and draws 100 glowing particles arranged in a small spherical
 * cluster around the clip-space origin, with slow per-particle float drift.
 *
 * Design notes:
 *  - All 100 points are issued in ONE draw call: gl.drawArrays(gl.POINTS, 0, 100).
 *  - Geometry lives in a single interleaved VBO: [x, y, z, phase] per vertex.
 *    Stride = 16 bytes (4 floats).  a_position at offset 0, a_phase at offset 12.
 *  - Positions are generated on the CPU once at init, then uploaded to the GPU.
 *  - Animation (the slow float drift) is computed entirely in the vertex shader
 *    via the u_time uniform — the VBO never changes after upload.
 *  - Additive blending (SRC_ALPHA, ONE) accumulates light, giving a natural
 *    cluster glow without alpha-sorting.
 */

import { type AnyGL }                    from './webgl';
import { createProgram, getUniform }     from './program';
import { PARTICLE_VERT, PARTICLE_FRAG }  from './shaders';

// ── Constants ─────────────────────────────────────────────────────────────────

const PARTICLE_COUNT = 100;

// Point-sprite canvas size in pixels.
// Core visible radius ≈ 6–8 px; the rest is soft halo.
const SPRITE_SIZE = 48;

// Base sphere radius in NDC units (clip space ±1).
// 0.14 ≈ a compact cluster — roughly 9 % of half-viewport width.
const SPHERE_RADIUS = 0.14;

// Max random radial jitter added to each particle for an organic feel.
const RADIUS_JITTER = 0.04;

// Floats per vertex in the interleaved VBO: x, y, z, phase.
const FLOATS_PER_VERTEX = 4;

// ── Geometry helpers ──────────────────────────────────────────────────────────

/** Seeded pseudo-random using a simple LCG — deterministic across reloads. */
function makePRNG(seed: number) {
  let s = seed;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/**
 * Generates `count` positions uniformly distributed on a sphere surface,
 * each with a small random radial jitter so the cluster looks organic.
 * Returns an interleaved Float32Array: [x, y, z, phase,  x, y, z, phase, …]
 */
function buildCluster(count: number): Float32Array {
  const data = new Float32Array(count * FLOATS_PER_VERTEX);
  const rand = makePRNG(42); // fixed seed → consistent look on every reload

  for (let i = 0; i < count; i++) {
    // Uniform sampling on the sphere surface (Marsaglia / trig method).
    const u     = rand();
    const v     = rand();
    const theta = Math.acos(2 * u - 1); // polar   angle [0, π]
    const phi   = 2 * Math.PI * v;      // azimuth angle [0, 2π]
    const r     = SPHERE_RADIUS + (rand() * 2 - 1) * RADIUS_JITTER;

    const base = i * FLOATS_PER_VERTEX;
    data[base    ] = Math.sin(theta) * Math.cos(phi) * r; // x
    data[base + 1] = Math.sin(theta) * Math.sin(phi) * r; // y
    data[base + 2] = Math.cos(theta)                 * r; // z
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
  const gl2 = gl as WebGL2RenderingContext; // we confirmed WebGL2 at init

  // ── Shader program ────────────────────────────────────────────────────────
  const program = createProgram(gl, PARTICLE_VERT, PARTICLE_FRAG);
  if (!program) return null;

  // ── Attribute locations ───────────────────────────────────────────────────
  const aPosition = gl.getAttribLocation(program, 'a_position');
  const aPhase    = gl.getAttribLocation(program, 'a_phase');

  if (aPosition < 0 || aPhase < 0) {
    console.error('[particle] One or more attribute locations not found — check shader source.');
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
  gl.bufferData(gl.ARRAY_BUFFER, clusterData, gl.STATIC_DRAW); // never changes
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  // ── VAO — attribute layout ────────────────────────────────────────────────
  const vao = gl2.createVertexArray();
  if (!vao) { gl.deleteProgram(program); gl.deleteBuffer(vbo); return null; }

  gl2.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);

  const stride = FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT; // 16 bytes

  // a_position: 3 floats, offset 0
  gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(aPosition);

  // a_phase: 1 float, offset 12 bytes (after x, y, z)
  const phaseOffset = 3 * Float32Array.BYTES_PER_ELEMENT;
  gl.vertexAttribPointer(aPhase, 1, gl.FLOAT, false, stride, phaseOffset);
  gl.enableVertexAttribArray(aPhase);

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl2.bindVertexArray(null);

  // ── Blending ──────────────────────────────────────────────────────────────
  // Additive blending accumulates light from overlapping particles.
  // Works correctly on a near-black background without alpha sorting.
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

  // ── Draw ──────────────────────────────────────────────────────────────────
  function draw(timeSeconds: number): void {
    gl.useProgram(program);

    if (uTime)      gl.uniform1f(uTime,      timeSeconds);
    if (uPointSize) gl.uniform1f(uPointSize, SPRITE_SIZE);

    gl2.bindVertexArray(vao);

    // Single draw call — all 100 particles, all geometry already on the GPU.
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
