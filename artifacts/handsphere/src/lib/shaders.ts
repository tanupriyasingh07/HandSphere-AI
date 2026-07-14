/**
 * shaders.ts
 * Raw GLSL source strings for every shader program in the project.
 * Each pair (vert / frag) is grouped together.
 */

// ── Particle shader ───────────────────────────────────────────────────────────
// Renders N points from a GPU-side position buffer.
// Each vertex carries a base clip-space position and a per-particle phase
// offset so the floating animation is desynchronised across the cluster.

export const PARTICLE_VERT = /* glsl */ `#version 300 es

// Per-vertex attributes — fed from the interleaved VBO each frame.
in vec3  a_position; // base clip-space position (x, y, z)
in float a_phase;    // per-particle phase offset [0, 2π]

uniform float u_time;      // elapsed seconds — drives position drift
uniform float u_pointSize; // total sprite size in pixels
uniform float u_rotation;  // Y-axis rotation angle in radians (slow auto-spin)

// Passed to fragment shader so back particles can be dimmed.
out float v_depth;

void main() {
  // ── Very slow organic float ─────────────────────────────────────────────
  vec3 pos = a_position;
  pos.x += cos(u_time * 0.38 + a_phase)        * 0.009;
  pos.y += sin(u_time * 0.51 + a_phase)        * 0.013;
  pos.z += sin(u_time * 0.29 + a_phase * 1.37) * 0.007;

  // ── Y-axis rotation ─────────────────────────────────────────────────────
  // Standard rotation matrix applied to (x, z); y is unchanged.
  float cosR = cos(u_rotation);
  float sinR = sin(u_rotation);
  vec3 rotPos;
  rotPos.x =  pos.x * cosR + pos.z * sinR;
  rotPos.y =  pos.y;
  rotPos.z = -pos.x * sinR + pos.z * cosR;

  // Pass raw rotated z to fragment shader for depth-based brightness.
  // Multiply by 5 so the ±0.20 NDC sphere range maps to roughly ±1.
  v_depth = rotPos.z * 5.0;

  gl_Position  = vec4(rotPos, 1.0);
  gl_PointSize = u_pointSize;
}
`;

export const PARTICLE_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform float u_time; // elapsed seconds — drives the brightness pulse

// Depth from vertex shader: positive = toward viewer, negative = away.
in float v_depth;

out vec4 fragColor;

void main() {
  // gl_PointCoord: (0,0) top-left → (1,1) bottom-right across the sprite.
  // Remap to [-1, 1] so the origin is at the sprite centre.
  vec2  uv   = gl_PointCoord * 2.0 - 1.0;
  float dist = length(uv);

  // Discard fragments outside the unit circle (square → circle clip).
  if (dist > 1.0) discard;

  // Tight bright core — very steep falloff so the dot stays small.
  float core = exp(-dist * dist * 22.0);

  // Narrow dim halo — contained within the sprite, won't bleed into neighbours.
  // With 3000 additive particles the halo coefficient must stay very low.
  float halo = exp(-dist * dist * 7.0) * 0.07;

  float brightness = core + halo;

  // Very subtle pulse — small amplitude so dim particles don't disappear.
  float pulse = 0.92 + 0.08 * sin(u_time * 1.8);
  brightness *= pulse;

  // ── Depth-based brightness ─────────────────────────────────────────────
  // Front particles (v_depth > 0) are brighter; back particles are dimmer.
  // clamp keeps the factor in [0.45, 1.0] so back particles stay visible.
  float depth        = clamp(v_depth, -1.0, 1.0);
  float depthFactor  = 0.72 + 0.28 * depth;
  brightness        *= depthFactor;

  // Premultiplied-alpha: colour = alpha = brightness.
  // Works correctly with additive blending (SRC_ALPHA, ONE).
  fragColor = vec4(brightness, brightness, brightness, brightness);
}
`;
