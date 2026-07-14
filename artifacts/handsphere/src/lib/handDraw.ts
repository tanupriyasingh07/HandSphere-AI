/**
 * handDraw.ts
 * 2D canvas drawing of MediaPipe hand landmarks and skeleton connections.
 *
 * Coordinate notes:
 *   - MediaPipe normalises landmarks to [0, 1] relative to the input frame.
 *   - The webcam video is CSS-mirrored (scaleX(-1)), so we flip x:
 *       screenX = (1 - landmark.x) * canvasWidth
 *   - y is not flipped.
 */

import type { Results } from '@mediapipe/hands';

// ── Skeleton connections ───────────────────────────────────────────────────────
// Defined locally so we don't depend on the HAND_CONNECTIONS export,
// which may not be tree-shaken correctly through all bundler versions.
const CONNECTIONS: [number, number][] = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index finger
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle finger
  [5, 9], [9, 10], [10, 11], [11, 12],
  // Ring finger
  [9, 13], [13, 14], [14, 15], [15, 16],
  // Pinky
  [13, 17], [17, 18], [18, 19], [19, 20],
  // Palm
  [0, 17],
];

// ── Visual style ───────────────────────────────────────────────────────────────
const LINE_COLOR      = 'rgba(255, 255, 255, 0.55)';
const LINE_WIDTH      = 1.5;

const DOT_COLOR_TIP   = 'rgba(255, 255, 255, 0.95)'; // fingertips (indices 4,8,12,16,20)
const DOT_COLOR_JOINT = 'rgba(200, 220, 255, 0.75)'; // all other joints
const DOT_RADIUS_TIP  = 5;
const DOT_RADIUS_JOINT = 3;

const FINGERTIP_INDICES = new Set([4, 8, 12, 16, 20]);

// ── Public draw function ───────────────────────────────────────────────────────

/**
 * Clears the overlay canvas and draws all detected hand skeletons.
 *
 * @param ctx     2D context of the overlay canvas.
 * @param results Latest MediaPipe Hands results.
 * @param w       Canvas pixel width.
 * @param h       Canvas pixel height.
 */
export function drawHands(
  ctx: CanvasRenderingContext2D,
  results: Results,
  w: number,
  h: number,
): void {
  ctx.clearRect(0, 0, w, h);

  const landmarkSets = results.multiHandLandmarks;
  if (!landmarkSets || landmarkSets.length === 0) return;

  for (const landmarks of landmarkSets) {
    // ── Connections (skeleton lines) ──────────────────────────────────────
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth   = LINE_WIDTH;
    ctx.lineCap     = 'round';

    for (const [from, to] of CONNECTIONS) {
      const a = landmarks[from];
      const b = landmarks[to];
      if (!a || !b) continue;

      ctx.beginPath();
      ctx.moveTo((1 - a.x) * w, a.y * h); // mirrored x
      ctx.lineTo((1 - b.x) * w, b.y * h);
      ctx.stroke();
    }

    // ── Landmark dots ─────────────────────────────────────────────────────
    for (let i = 0; i < landmarks.length; i++) {
      const lm  = landmarks[i];
      const tip = FINGERTIP_INDICES.has(i);
      const sx  = (1 - lm.x) * w;
      const sy  = lm.y * h;

      ctx.beginPath();
      ctx.arc(sx, sy, tip ? DOT_RADIUS_TIP : DOT_RADIUS_JOINT, 0, Math.PI * 2);
      ctx.fillStyle = tip ? DOT_COLOR_TIP : DOT_COLOR_JOINT;
      ctx.fill();
    }
  }
}
