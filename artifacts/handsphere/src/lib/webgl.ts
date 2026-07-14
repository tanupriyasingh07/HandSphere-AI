/**
 * webgl.ts
 * WebGL2 / WebGL1 initialization and per-frame helpers.
 * No shaders, no draw calls — just context setup and clear.
 */

// ── Background colour ────────────────────────────────────────────────────────
// #050505  →  R 5, G 5, B 5  →  normalised to [0, 1]
const R = 5 / 255;
const G = 5 / 255;
const B = 5 / 255;

// ── Types ────────────────────────────────────────────────────────────────────
export type AnyGL = WebGL2RenderingContext | WebGLRenderingContext;

export interface GLState {
  gl: AnyGL;
  version: 2 | 1; // which API was obtained
}

// ── Initialisation ───────────────────────────────────────────────────────────
/**
 * Tries WebGL2, then WebGL1 as a fallback.
 * Returns null when neither is available (e.g. software renderer blocked).
 */
export function initWebGL(canvas: HTMLCanvasElement): GLState | null {
  // Attempt WebGL2 first
  const gl2 = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
  if (gl2) {
    console.info('[WebGL] context obtained: WebGL2');
    return { gl: gl2, version: 2 };
  }

  // Fallback: WebGL1
  const gl1 = canvas.getContext('webgl') as WebGLRenderingContext | null;
  if (gl1) {
    console.warn('[WebGL] WebGL2 unavailable — falling back to WebGL1');
    return { gl: gl1, version: 1 };
  }

  console.error('[WebGL] Neither WebGL2 nor WebGL1 is available in this browser.');
  return null;
}

// ── Viewport ─────────────────────────────────────────────────────────────────
/**
 * Updates the GL viewport to match the canvas pixel dimensions.
 * Must be called after every resize.
 */
export function setViewport(gl: AnyGL, width: number, height: number): void {
  gl.viewport(0, 0, width, height);
}

// ── Per-frame clear ───────────────────────────────────────────────────────────
/**
 * Clears the colour buffer to #050505 each frame.
 * Call once at the start of every render loop iteration.
 */
export function clearFrame(gl: AnyGL): void {
  gl.clearColor(R, G, B, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
}
