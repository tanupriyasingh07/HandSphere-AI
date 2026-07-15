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
in vec3  a_position; // base world-space position (x, y, z)
in float a_phase;    // per-particle phase offset [0, 2π]

uniform float u_time;        // elapsed seconds — drives position drift
uniform float u_pointSize;   // base sprite size in pixels (scaled by perspective)
uniform float u_rotation;    // Y-axis rotation angle in radians (slow auto-spin)
uniform vec2  u_offset;      // screen-space translation for palm following [−1, 1]
uniform float u_tilt;        // Z-axis roll driven by palm orientation (radians)
uniform float u_chargeLevel; // 0 = orbit, 1 = fully compressed toward centre
uniform float u_explodeAge;  // 0 = no explosion; 0→1 = explosion arc in progress

// Passed to fragment shader.
out float v_depth; // depth for back-to-front brightness shading
out float v_phase; // per-particle phase → unique neon colour in frag

// ── Perspective camera ───────────────────────────────────────────────────────
const float CAMERA_Z = 0.70;
const float FOCAL    = 0.70;

void main() {
  // ── Organic float ─────────────────────────────────────────────────────────
  vec3 pos = a_position;
  pos.x += cos(u_time * 0.38 + a_phase)        * 0.009;
  pos.y += sin(u_time * 0.51 + a_phase)        * 0.013;
  pos.z += sin(u_time * 0.29 + a_phase * 1.37) * 0.007;

  // ── Charge: attract all particles toward the sphere centre ───────────────
  // At u_chargeLevel = 1.0 every particle converges to ~8 % of its orbit
  // radius (a_position * 0.08), forming a dense glowing energy core.
  // The residual 8 % keeps the cluster alive so it doesn't become a static dot.
  pos = mix(pos, vec3(0.0), u_chargeLevel * 0.92);

  // ── Explosion: radial burst, then arc back to home position ─────────────
  // u_explodeAge runs 0 → 1 over the full explosion duration.
  // Envelope:  env = t*(1-t)*4  — peaks at t=0.5 (value 1.0), zero at t=0 and t=1.
  // Per-particle randomised speed/direction derived entirely from a_phase
  // so the VBO never needs updating after upload.
  if (u_explodeAge > 0.0) {
    // Two independent pseudo-random scalars from the phase value.
    float rand1 = fract(sin(a_phase * 127.1 + 43.7) * 43758.5); // [0, 1]
    float rand2 = fract(sin(a_phase * 311.7 + 17.1) * 27341.9); // [0, 1]
    float speedMult = 0.4 + rand1 * 1.2;  // [0.4, 1.6] — natural spread

    // Radial home direction from sphere centre, with a small angular nudge
    // so particles from nearby home positions don't all fly identically.
    vec3  homeDir    = normalize(a_position);
    float angle      = rand2 * 6.28318;
    vec3  perturb    = vec3(cos(angle) * 0.35, sin(angle) * 0.35, 0.0);
    vec3  explodeDir = normalize(homeDir + perturb);

    // Parabolic travel: 0 at start, peaks mid-flight, returns to 0 at end.
    float env    = u_explodeAge * (1.0 - u_explodeAge) * 4.0;
    env          = max(env, 0.0); // guard float noise past t=1
    float travel = env * speedMult * 0.82;

    // Add explosion displacement ON TOP of the (possibly compressed) position.
    // This means the burst fires from the compressed core — a "spring release".
    pos += explodeDir * travel;
  }

  // ── Z-axis tilt (palm roll) ──────────────────────────────────────────────
  float cosT = cos(u_tilt);
  float sinT = sin(u_tilt);
  vec3 tilted;
  tilted.x = pos.x * cosT - pos.y * sinT;
  tilted.y = pos.x * sinT + pos.y * cosT;
  tilted.z = pos.z;
  pos = tilted;

  // ── Y-axis rotation ─────────────────────────────────────────────────────
  float cosR = cos(u_rotation);
  float sinR = sin(u_rotation);
  vec3 rotPos;
  rotPos.x =  pos.x * cosR + pos.z * sinR;
  rotPos.y =  pos.y;
  rotPos.z = -pos.x * sinR + pos.z * cosR;

  // ── Perspective projection ───────────────────────────────────────────────
  float d    = CAMERA_Z - rotPos.z;
  float invD = FOCAL / d;  // = 1.0 at sphere centre

  v_depth = rotPos.z * 5.0;
  v_phase = a_phase;

  // Particles grow slightly during explosion for dramatic impact.
  float sizeBoost = 1.0 + u_explodeAge * 0.7;

  gl_Position  = vec4(rotPos.x * invD + u_offset.x, rotPos.y * invD + u_offset.y, 0.0, 1.0);
  gl_PointSize = u_pointSize * invD * sizeBoost;
}
`;

export const PARTICLE_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform float u_time;       // elapsed seconds — drives the brightness pulse
uniform vec3  u_color;      // base tint: white during orbit; cycles through charge colours
uniform float u_glowBoost;  // halo intensity multiplier (1.0 = normal; grows with charge)
uniform float u_neonBlend;  // 0 = u_color, 1 = per-particle neon rainbow (explosion)
uniform float u_explodeAge; // slowly rotates neon hues during explosion (0 when idle)

in float v_depth;
in float v_phase; // per-particle phase → unique position in neon rainbow

out vec4 fragColor;

// ── 6-stop neon hue cycle ────────────────────────────────────────────────────
// Cyan → electric blue → violet → hot pink → amber → lime → cyan
// Each particle sits at a different h derived from its phase, so the explosion
// produces a full rainbow spread rather than a single colour flash.
vec3 neonHue(float h) {
  h = fract(h);
  if      (h < 0.167) return mix(vec3(0.00, 0.90, 1.00), vec3(0.10, 0.30, 1.00), h / 0.167);
  else if (h < 0.333) return mix(vec3(0.10, 0.30, 1.00), vec3(0.70, 0.00, 1.00), (h - 0.167) / 0.167);
  else if (h < 0.500) return mix(vec3(0.70, 0.00, 1.00), vec3(1.00, 0.00, 0.50), (h - 0.333) / 0.167);
  else if (h < 0.667) return mix(vec3(1.00, 0.00, 0.50), vec3(1.00, 0.65, 0.00), (h - 0.500) / 0.167);
  else if (h < 0.833) return mix(vec3(1.00, 0.65, 0.00), vec3(0.20, 1.00, 0.20), (h - 0.667) / 0.167);
  else                return mix(vec3(0.20, 1.00, 0.20), vec3(0.00, 0.90, 1.00), (h - 0.833) / 0.167);
}

void main() {
  vec2  uv   = gl_PointCoord * 2.0 - 1.0;
  float dist = length(uv);
  if (dist > 1.0) discard;

  // Tight core + narrow halo (additive-safe coefficients, unchanged from orbit).
  float core = exp(-dist * dist * 22.0);
  float halo = exp(-dist * dist *  7.0) * 0.07 * u_glowBoost;
  float brightness = core + halo;

  // Subtle breathing pulse (unchanged from original).
  float pulse = 0.92 + 0.08 * sin(u_time * 1.8);
  brightness *= pulse;

  // Depth-based dimming: back particles are darker than front particles.
  float depth       = clamp(v_depth, -1.0, 1.0);
  float depthFactor = 0.72 + 0.28 * depth;
  brightness       *= depthFactor;

  // ── Colour ────────────────────────────────────────────────────────────────
  // Each particle has a unique neon hue derived from v_phase.
  // u_explodeAge slowly rotates all hues so the rainbow shifts as the burst expands.
  float hue  = fract(v_phase / 6.28318 + u_explodeAge * 0.35);
  vec3  neon = neonHue(hue);

  // u_neonBlend = 0 during orbit/charge (use u_color), 1 at peak explosion.
  vec3 tint = mix(u_color, neon, u_neonBlend);

  // Premultiplied-alpha; works correctly with additive blend (SRC_ALPHA, ONE).
  fragColor = vec4(brightness * tint, brightness);
}
`;
