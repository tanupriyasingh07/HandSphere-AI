/**
 * particle.ts
 * Creates and draws a single centred glowing particle using gl.POINTS.
 *
 * Design notes:
 *  - No vertex buffer is needed — position is hard-coded in the vertex shader.
 *  - We use a WebGL2 VAO (empty) so the draw call is fully spec-compliant.
 *  - Additive blending (SRC_ALPHA, ONE) gives the glow bloom on a dark bg.
 *  - gl_PointSize is set to SPRITE_SIZE; the fragment shader sculpts the
 *    visible core+halo inside that square with exponential falloff.
 */

import { type AnyGL }                       from './webgl';
import { createProgram, getUniform }        from './program';
import { PARTICLE_VERT, PARTICLE_FRAG }     from './shaders';

// Total point-sprite size in pixels.
// The bright core occupies the inner ~10 px; the halo fills the rest.
const SPRITE_SIZE = 64;

// ── Public interface ──────────────────────────────────────────────────────────

export interface ParticleRenderer {
  /** Draw one frame. Call every rAF tick after clearFrame(). */
  draw(timeSeconds: number): void;
  /** Release all GPU resources. Call on unmount or context loss. */
  dispose(): void;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Compiles shaders, queries uniform locations, and sets up blending.
 * Returns null if shader compilation or program linking fails.
 */
export function createParticleRenderer(gl: AnyGL): ParticleRenderer | null {
  // ── Shader program ──────────────────────────────────────────────────────
  const program = createProgram(gl, PARTICLE_VERT, PARTICLE_FRAG);
  if (!program) return null;

  // ── Uniform locations ────────────────────────────────────────────────────
  const uTime      = getUniform(gl, program, 'u_time');
  const uPointSize = getUniform(gl, program, 'u_pointSize');

  // ── Empty VAO (WebGL2) ───────────────────────────────────────────────────
  // An empty VAO is required in WebGL2 for draw calls with no attributes.
  let vao: WebGLVertexArrayObject | null = null;
  if ('createVertexArray' in gl) {
    // WebGL2 path
    vao = (gl as WebGL2RenderingContext).createVertexArray();
    (gl as WebGL2RenderingContext).bindVertexArray(vao);
    (gl as WebGL2RenderingContext).bindVertexArray(null);
  }

  // ── Blending ─────────────────────────────────────────────────────────────
  // Additive blending: destination += source * srcAlpha.
  // This accumulates light on the dark background — classic glow technique.
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

  // ── Draw ──────────────────────────────────────────────────────────────────
  function draw(timeSeconds: number): void {
    gl.useProgram(program);

    // Upload uniforms
    if (uTime)      gl.uniform1f(uTime,      timeSeconds);
    if (uPointSize) gl.uniform1f(uPointSize, SPRITE_SIZE);

    // Bind empty VAO (WebGL2) or nothing (WebGL1)
    if (vao && 'bindVertexArray' in gl) {
      (gl as WebGL2RenderingContext).bindVertexArray(vao);
    }

    // Draw a single point — the vertex shader places it at clip-space (0, 0).
    gl.drawArrays(gl.POINTS, 0, 1);

    // Unbind
    if ('bindVertexArray' in gl) {
      (gl as WebGL2RenderingContext).bindVertexArray(null);
    }
    gl.useProgram(null);
  }

  // ── Dispose ───────────────────────────────────────────────────────────────
  function dispose(): void {
    gl.deleteProgram(program);
    if (vao && 'deleteVertexArray' in gl) {
      (gl as WebGL2RenderingContext).deleteVertexArray(vao);
    }
    gl.disable(gl.BLEND);
  }

  return { draw, dispose };
}
