/**
 * shaders.ts
 * Raw GLSL source strings for every shader program in the project.
 * Each pair (vert / frag) is grouped together.
 */

// ── Particle shader ───────────────────────────────────────────────────────────
// Renders a single gl.POINTS primitive.
// The point sprite is 64 px so there is room for the soft glow halo;
// the bright core lands at roughly 8–12 px of perceived radius.

export const PARTICLE_VERT = /* glsl */ `#version 300 es

// No per-vertex attributes — position is hard-coded to clip-space centre.
uniform float u_pointSize; // total sprite size in pixels

void main() {
  gl_Position  = vec4(0.0, 0.0, 0.0, 1.0); // centre of the viewport
  gl_PointSize = u_pointSize;
}
`;

export const PARTICLE_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform float u_time; // elapsed seconds — drives the glow pulse

out vec4 fragColor;

void main() {
  // gl_PointCoord: (0,0) top-left → (1,1) bottom-right across the sprite.
  // Remap to [-1, 1] so the centre is at (0,0).
  vec2  uv   = gl_PointCoord * 2.0 - 1.0;
  float dist = length(uv);

  // Discard fragments outside the unit circle (square → circle).
  if (dist > 1.0) discard;

  // Tight bright core — falls off very quickly.
  float core = exp(-dist * dist * 14.0);

  // Wide soft halo — falls off gently for the glow bloom.
  float halo = exp(-dist * dist * 2.8) * 0.55;

  float brightness = core + halo;

  // Subtle sinusoidal pulse — ±15 % over ~3.5 s period.
  float pulse = 0.85 + 0.15 * sin(u_time * 1.8);
  brightness *= pulse;

  // Premultiplied-alpha style: colour = brightness, alpha = brightness.
  // Works correctly with additive blending (SRC_ALPHA, ONE).
  fragColor = vec4(brightness, brightness, brightness, brightness);
}
`;
