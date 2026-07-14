/**
 * handTracker.ts
 * Thin wrapper around MediaPipe Hands.
 *
 * WASM and model files are fetched from jsDelivr CDN so nothing heavy
 * is bundled into the Vite output — only the lightweight JS loader.
 */

import { Hands } from '@mediapipe/hands';
export type { Results } from '@mediapipe/hands';

const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands';

/**
 * Creates and configures a MediaPipe Hands instance.
 * Registers the results callback immediately.
 *
 * Call `hands.close()` to release GPU/WASM resources when done.
 */
export function createHandTracker(
  onResults: (results: import('@mediapipe/hands').Results) => void,
): Hands {
  const hands = new Hands({
    // Point all asset fetches (WASM, binary graph, model) at the CDN.
    locateFile: (file: string) => `${CDN}/${file}`,
  });

  hands.setOptions({
    maxNumHands:            2,   // track up to two hands
    modelComplexity:        1,   // 0 = lite, 1 = full
    minDetectionConfidence: 0.7,
    minTrackingConfidence:  0.5,
  });

  hands.onResults(onResults);
  return hands;
}
