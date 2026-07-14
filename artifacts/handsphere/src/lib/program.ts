/**
 * program.ts
 * Helpers for compiling GLSL shaders and linking WebGL programs.
 * These are pure utility functions — they hold no GL state themselves.
 */

import { type AnyGL } from './webgl';

// ── Shader compilation ────────────────────────────────────────────────────────

/**
 * Compiles a single GLSL shader stage.
 * @param gl     Active GL context.
 * @param type   gl.VERTEX_SHADER or gl.FRAGMENT_SHADER.
 * @param source GLSL source string (must start with '#version …').
 * @returns      Compiled WebGLShader, or null on failure.
 */
export function compileShader(
  gl: AnyGL,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) {
    console.error('[program] gl.createShader failed — context may be lost.');
    return null;
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const label = type === gl.VERTEX_SHADER ? 'VERTEX' : 'FRAGMENT';
    console.error(`[program] ${label} shader compile error:\n`, gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

// ── Program linking ───────────────────────────────────────────────────────────

/**
 * Links a vertex + fragment shader into a ready-to-use WebGLProgram.
 * Compiled shader objects are detached and deleted after linking (best practice).
 * @returns Linked WebGLProgram, or null on failure.
 */
export function createProgram(
  gl: AnyGL,
  vertSource: string,
  fragSource: string,
): WebGLProgram | null {
  const vert = compileShader(gl, gl.VERTEX_SHADER,   vertSource);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSource);

  if (!vert || !frag) {
    // Individual errors already logged inside compileShader.
    if (vert) gl.deleteShader(vert);
    if (frag) gl.deleteShader(frag);
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    console.error('[program] gl.createProgram failed.');
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    return null;
  }

  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);

  // Detach + delete shaders — they are compiled into the program now.
  gl.detachShader(program, vert);
  gl.detachShader(program, frag);
  gl.deleteShader(vert);
  gl.deleteShader(frag);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[program] Program link error:\n', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  return program;
}

// ── Uniform location helpers ──────────────────────────────────────────────────

/**
 * Fetches a uniform location and warns if it is missing (e.g. optimised away).
 */
export function getUniform(
  gl: AnyGL,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation | null {
  const loc = gl.getUniformLocation(program, name);
  if (loc === null) {
    console.warn(`[program] Uniform '${name}' not found — may be optimised out.`);
  }
  return loc;
}
