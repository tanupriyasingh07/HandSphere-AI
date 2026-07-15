/**
 * App.tsx
 * Root component. Owns the fullscreen canvas, WebGL context lifecycle,
 * animation loop, FPS counter, HUD overlays, webcam layer, and
 * MediaPipe Hands tracking overlay.
 *
 * Layer stack (back → front):
 *   1. #050505 wrapper background
 *   2. <video>          — live webcam feed
 *   3. <canvas> WebGL   — particle sphere  (mix-blend-mode: screen)
 *   4. <canvas> 2D      — hand landmarks   (no blend mode)
 *   5. HUD spans/divs   — title, FPS, debug panel, webcam button
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { initWebGL, setViewport, clearFrame, type AnyGL } from '@/lib/webgl';
import { createParticleRenderer, type ParticleRenderer }  from '@/lib/particle';
import { createHandTracker, type Results }                 from '@/lib/handTracker';
import { drawHands }                                       from '@/lib/handDraw';

import type { Hands }                                      from '@mediapipe/hands';

export default function App() {
  // ── WebGL refs ────────────────────────────────────────────────────────────
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const glRef       = useRef<AnyGL | null>(null);
  const rafRef      = useRef<number>(0);
  const particleRef = useRef<ParticleRenderer | null>(null);


  // ── Webcam refs ───────────────────────────────────────────────────────────
  const videoRef  = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // ── Hand-tracking refs ────────────────────────────────────────────────────
  const overlayRef  = useRef<HTMLCanvasElement>(null);  // 2D drawing surface
  const handsRef    = useRef<Hands | null>(null);       // MediaPipe instance
  const sendingRef  = useRef(false);                    // prevent concurrent sends
  const resultsRef  = useRef<Results | null>(null);     // latest MP results
  const palmTargetRef   = useRef({ x: 0, y: 0 }); // raw palm NDC target from MP
  const sphereOffsetRef = useRef({ x: 0, y: 0 }); // lerped sphere position
  const tiltTargetRef   = useRef(0);               // raw tilt angle from LM5–LM17 (rad)
  const sphereTiltRef   = useRef(0);               // lerped tilt angle
  // ── Energy-system refs (ORBIT → CHARGE → EXPLODE → ORBIT state machine) ──
  const energyStateRef = useRef<'ORBIT' | 'CHARGE' | 'EXPLODE'>('ORBIT');
  const chargeRef      = useRef(0);  // 0→1 lerped; drives compression + colour
  const explodeAgeRef  = useRef(0);  // raw seconds since explosion fired (0 when idle)
  const colorPhaseRef  = useRef(0);  // colour-cycle position; advances during CHARGE
  const neonBlendRef   = useRef(0);  // 0→1 lerped; blends per-particle neon into frag

  // ── Pinch-detection refs ──────────────────────────────────────────────────
  // Distances are in MediaPipe normalised-landmark space (roughly 0–1).
  // PINCH_CLOSE < PINCH_OPEN creates hysteresis so the state doesn't flicker.
  const PINCH_CLOSE      = 0.06;  // enter-pinch threshold
  const PINCH_OPEN       = 0.10;  // exit-pinch threshold  (gap = hysteresis band)
  const PINCH_SMOOTH     = 0.25;  // EMA alpha: higher = more responsive, noisier
  const EXPLODE_DURATION = 1.5;   // seconds for the full explosion + return arc
  const pinchDistRef   = useRef(1);      // EMA-smoothed thumb-index distance
  const pinchActiveRef = useRef(false);  // current hysteretic pinch state

  // ── UI state ──────────────────────────────────────────────────────────────
  const [fps,       setFps]       = useState(0);
  const [glVersion, setGLVersion] = useState<string>('');
  const [ctxLost,   setCtxLost]   = useState(false);
  const [webcamOn,  setWebcamOn]  = useState(false);
  const [handCount, setHandCount] = useState(0);
  const [gesture,   setGesture]   = useState<'OPEN' | 'PINCH'>('OPEN');

  // ── WebGL + render loop ───────────────────────────────────────────────────
  useEffect(() => {
    const canvas  = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas) return;

    // WebGL init
    const state = initWebGL(canvas);
    if (!state) { console.error('[App] Could not obtain a WebGL context.'); return; }
    glRef.current = state.gl;
    setGLVersion(`WebGL${state.version}`);

    // Particle renderer
    particleRef.current = createParticleRenderer(state.gl);

    // Resize — keep WebGL canvas and 2D overlay in sync with viewport
    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;

      canvas.width  = w;
      canvas.height = h;
      if (glRef.current) setViewport(glRef.current, w, h);

      if (overlay) { overlay.width = w; overlay.height = h; }
    };
    resize();
    window.addEventListener('resize', resize);

    // Context loss
    const onContextLost = (e: Event) => {
      e.preventDefault();
      setCtxLost(true);
      cancelAnimationFrame(rafRef.current);
      console.warn('[WebGL] Context lost.');
    };
    const onContextRestored = () => {
      setCtxLost(false);
      console.info('[WebGL] Context restored — reinitialising.');
      const restored = initWebGL(canvas);
      if (restored) {
        glRef.current       = restored.gl;
        particleRef.current = createParticleRenderer(restored.gl);
        resize();
        startLoop();
      }
    };
    canvas.addEventListener('webglcontextlost',     onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    // Animation loop
    const startTime = performance.now();
    let lastTime    = startTime;
    let frameCount  = 0;
    let fpsAccum    = 0;

    const loop = (now: number) => {
      const delta   = now - lastTime;
      lastTime      = now;
      const timeSec = (now - startTime) / 1000;

      // FPS counter (sampled every 500 ms)
      frameCount++;
      fpsAccum += delta;
      if (fpsAccum >= 500) {
        setFps(Math.round((frameCount * 1000) / fpsAccum));
        frameCount = 0;
        fpsAccum   = 0;
      }

      // ── Energy system: ORBIT → CHARGE → EXPLODE → ORBIT ─────────────
      const dt = delta / 1000; // frame delta in seconds

      // Advance explosion timer; automatically return to ORBIT when complete.
      if (energyStateRef.current === 'EXPLODE') {
        explodeAgeRef.current += dt;
        if (explodeAgeRef.current >= EXPLODE_DURATION) {
          energyStateRef.current = 'ORBIT';
          explodeAgeRef.current  = 0;
        }
      }

      // Charge level: lerps up slowly during CHARGE (builds tension), drops
      // quickly during EXPLODE so the compressed core "springs open".
      const chargeTarget = energyStateRef.current === 'CHARGE' ? 1 : 0;
      const chargeK      = energyStateRef.current === 'EXPLODE' ? 0.12 : 0.04;
      chargeRef.current += (chargeTarget - chargeRef.current) * chargeK;
      const cl = chargeRef.current; // convenience alias used below + in draw()

      // Neon blend: ramps up fast when explosion fires, fades out afterward.
      const neonTarget = energyStateRef.current === 'EXPLODE' ? 1 : 0;
      const neonK      = energyStateRef.current === 'EXPLODE' ? 0.15 : 0.06;
      neonBlendRef.current += (neonTarget - neonBlendRef.current) * neonK;

      // Colour cycle advances during CHARGE and speeds up as charge builds.
      // Stops advancing during EXPLODE/ORBIT so it resumes naturally next time.
      if (energyStateRef.current === 'CHARGE') {
        colorPhaseRef.current += dt * (0.5 + cl * 1.8);
      }

      // 4-stop colour cycle: white → electric blue → deep purple → warm orange → white
      const cp = ((colorPhaseRef.current % 1) + 1) % 1;
      const STOPS: [number, number, number][] = [
        [1.00, 1.00, 1.00],  // 0.00 white
        [0.20, 0.50, 1.00],  // 0.25 electric blue
        [0.70, 0.10, 1.00],  // 0.50 deep purple
        [1.00, 0.45, 0.05],  // 0.75 warm orange
        [1.00, 1.00, 1.00],  // 1.00 white (wraps)
      ];
      const si = Math.min(Math.floor(cp * 4), 3);
      const sf = cp * 4 - si;
      const sa = STOPS[si], sb = STOPS[si + 1];
      const cycleColor: [number, number, number] = [
        sa[0] + (sb[0] - sa[0]) * sf,
        sa[1] + (sb[1] - sa[1]) * sf,
        sa[2] + (sb[2] - sa[2]) * sf,
      ];

      // Interpolate from white toward the current cycle colour as charge grows.
      const particleColor: [number, number, number] = [
        1 + (cycleColor[0] - 1) * cl,
        1 + (cycleColor[1] - 1) * cl,
        1 + (cycleColor[2] - 1) * cl,
      ];
      // Glow grows strongly with charge; extra brightness during explosion.
      const glowBoost = 1.0 + cl * 2.5 + neonBlendRef.current * 1.2;

      // Normalised explosion age for the shader (0 outside explosion phase).
      const explodeAge = energyStateRef.current === 'EXPLODE'
        ? Math.min(explodeAgeRef.current / EXPLODE_DURATION, 1.0)
        : 0;

      // ── Lerp sphere toward palm target ──────────────────────────────
      // LERP_K = 0.10 → ~99 % convergence in ~45 frames (≈ 0.75 s at 60 fps).
      // palmTargetRef resets to (0,0) when no hand is present so the sphere
      // drifts back to centre automatically.
      const LERP_K = 0.10;
      const tgt = palmTargetRef.current;
      const off = sphereOffsetRef.current;
      off.x += (tgt.x - off.x) * LERP_K;
      off.y += (tgt.y - off.y) * LERP_K;
      sphereTiltRef.current += (tiltTargetRef.current - sphereTiltRef.current) * LERP_K;

      // ── WebGL: clear + particles ─────────────────────────────────────
      if (glRef.current) {
        clearFrame(glRef.current);
        particleRef.current?.draw(
          timeSec, off.x, off.y, sphereTiltRef.current,
          particleColor, glowBoost,
          cl, explodeAge, neonBlendRef.current,
        );
      }

      // ── MediaPipe: send frame (non-blocking, rate-limited by sendingRef)
      const video = videoRef.current;
      if (
        handsRef.current &&
        video &&
        video.readyState >= 2 &&   // HAVE_CURRENT_DATA
        !sendingRef.current
      ) {
        sendingRef.current = true;
        handsRef.current
          .send({ image: video })
          .catch(console.warn)
          .finally(() => { sendingRef.current = false; });
      }

      // ── 2D overlay: draw hand skeleton from latest results ───────────
      if (overlay && resultsRef.current) {
        const ctx = overlay.getContext('2d');
        if (ctx) drawHands(ctx, resultsRef.current, overlay.width, overlay.height);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    const startLoop = () => {
      lastTime       = performance.now();
      frameCount     = 0;
      fpsAccum       = 0;
      rafRef.current = requestAnimationFrame(loop);
    };

    startLoop();

    return () => {
      cancelAnimationFrame(rafRef.current);
      particleRef.current?.dispose();
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('webglcontextlost',     onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
    };
  }, []);

  // ── Webcam + hand-tracker cleanup on unmount ──────────────────────────────
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      handsRef.current?.close();
    };
  }, []);

  // ── Webcam + hand-tracker toggle ──────────────────────────────────────────
  const toggleWebcam = useCallback(async () => {
    if (!webcamOn) {
      // ── Turn ON ─────────────────────────────────────────────────────────
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setWebcamOn(true);

        // Initialise MediaPipe Hands after stream is live
        const tracker = createHandTracker((results: Results) => {
          resultsRef.current = results;
          const lmSets = results.multiHandLandmarks;
          const count  = lmSets?.length ?? 0;
          setHandCount(count);

          if (count > 0) {
            // Average wrist (0) + four knuckle bases (5, 9, 13, 17) for a
            // stable palm centre that doesn't jump with finger movement.
            const lm      = lmSets[0];
            const indices = [0, 5, 9, 13, 17];
            let sumX = 0, sumY = 0;
            for (const i of indices) { sumX += lm[i].x; sumY += lm[i].y; }
            const raw = sumX / indices.length;
            const ray = sumY / indices.length;
            // x: mirror to match CSS scaleX(-1) video, map [0,1] → NDC [-1,1]
            // y: flip because MP y=0 is top but NDC y=+1 is top
            palmTargetRef.current = { x: 1 - 2 * raw, y: 1 - 2 * ray };

            // Tilt: angle of the LM17 → LM5 knuckle line from horizontal.
            // |dx| removes left-vs-right ambiguity; result is in [−π/2, π/2].
            // tdy = lm17.y − lm5.y: positive when LM5 is higher on screen
            // (MP y = 0 at top), so positive tilt → index-up = CCW roll.
            const lm5  = lm[5];
            const lm17 = lm[17];
            const tdx  = Math.abs(lm5.x - lm17.x);
            const tdy  = lm17.y - lm5.y;
            tiltTargetRef.current = Math.atan2(tdy, tdx);

            // ── Pinch detection ──────────────────────────────────────────
            // Raw distance between thumb tip (LM4) and index tip (LM8).
            const lm4 = lm[4];
            const lm8 = lm[8];
            const dx  = lm4.x - lm8.x;
            const dy  = lm4.y - lm8.y;
            const rawDist = Math.sqrt(dx * dx + dy * dy);

            // EMA smoothing: damps single-frame noise while staying responsive.
            pinchDistRef.current +=
              PINCH_SMOOTH * (rawDist - pinchDistRef.current);

            // Hysteresis: only cross state boundaries when the smoothed distance
            // clearly crosses the close/open thresholds.
            const smoothed = pinchDistRef.current;
            if (!pinchActiveRef.current && smoothed < PINCH_CLOSE) {
              pinchActiveRef.current = true;
              setGesture('PINCH');
              console.log('Pinch Started');
              energyStateRef.current = 'CHARGE';
            } else if (pinchActiveRef.current && smoothed > PINCH_OPEN) {
              pinchActiveRef.current = false;
              setGesture('OPEN');
              console.log('Pinch Released');
              // Trigger explosion only if we were in the charge phase.
              energyStateRef.current = energyStateRef.current === 'CHARGE'
                ? 'EXPLODE' : 'ORBIT';
              if (energyStateRef.current === 'EXPLODE') explodeAgeRef.current = 0;
            } else if (pinchActiveRef.current) {
              console.log('Pinching');
            }
          } else {
            palmTargetRef.current = { x: 0, y: 0 };
            tiltTargetRef.current = 0;

            // Hand left frame — treat as pinch release; trigger explosion if charging.
            if (pinchActiveRef.current) {
              pinchActiveRef.current = false;
              setGesture('OPEN');
              console.log('Pinch Released');
              energyStateRef.current = energyStateRef.current === 'CHARGE'
                ? 'EXPLODE' : 'ORBIT';
              if (energyStateRef.current === 'EXPLODE') explodeAgeRef.current = 0;
            }
            pinchDistRef.current = 1;
          }
        });
        handsRef.current = tracker;
      } catch (err) {
        console.warn('[webcam] Permission denied or device unavailable:', err);
      }
    } else {
      // ── Turn OFF ─────────────────────────────────────────────────────────
      // Stop MediaPipe
      handsRef.current?.close();
      handsRef.current  = null;
      resultsRef.current = null;
      setHandCount(0);

      // Clear overlay canvas
      const overlay = overlayRef.current;
      if (overlay) {
        overlay.getContext('2d')?.clearRect(0, 0, overlay.width, overlay.height);
      }

      // Stop webcam stream
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setWebcamOn(false);
    }
  }, [webcamOn]);

  // ── Render ────────────────────────────────────────────────────────────────
  const trackingLabel = !webcamOn ? '—'
    : handCount > 0   ? 'ACTIVE'
    :                   'LOST';

  const trackingColor = !webcamOn         ? 'rgba(255,255,255,0.22)'
    : handCount > 0                        ? 'rgba(160,255,160,0.80)'
    :                                        'rgba(255,140,140,0.65)';

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#050505' }}>

      {/* ── 1. Webcam video ─────────────────────────────────────────────── */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          position:   'absolute',
          inset:       0,
          width:      '100%',
          height:     '100%',
          objectFit:  'cover',
          transform:  'scaleX(-1)',          // mirror so user sees themselves
          visibility:  webcamOn ? 'visible' : 'hidden',
        }}
      />

      {/* ── 2. WebGL particle canvas ─────────────────────────────────────
           mix-blend-mode: screen → dark clear (#050505 ≈ 0.02) is transparent;
           bright particle glows add on top of the video feed.              */}
      <canvas
        ref={canvasRef}
        style={{
          position:     'absolute',
          inset:         0,
          width:        '100%',
          height:       '100%',
          mixBlendMode: 'screen',
        }}
      />

      {/* ── 3. 2D hand-landmark overlay ──────────────────────────────────
           Plain canvas — no blend mode — sits above the WebGL layer.
           pointer-events: none so it never blocks UI interaction.          */}
      <canvas
        ref={overlayRef}
        style={{
          position:      'absolute',
          inset:          0,
          width:         '100%',
          height:        '100%',
          pointerEvents: 'none',
        }}
      />

      {/* Context-loss warning */}
      {ctxLost && (
        <div style={{
          position: 'fixed', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgba(255,100,100,0.8)', fontFamily: 'Menlo, monospace',
          fontSize: '0.75rem', pointerEvents: 'none',
        }}>
          WebGL context lost — waiting for restore…
        </div>
      )}

      {/* ── Title — top left ─────────────────────────────────────────────── */}
      <span style={{
        position:      'fixed',
        top:           '1.5rem',
        left:          '1.75rem',
        fontFamily:    'Georgia, "Times New Roman", serif',
        fontSize:      '1.25rem',
        fontWeight:     400,
        letterSpacing: '0.04em',
        color:         'rgba(255,255,255,0.88)',
        pointerEvents: 'none',
        userSelect:    'none',
      }}>
        HandSphere AI
      </span>

      {/* ── Debug panel — bottom left ─────────────────────────────────────── */}
      <div style={{
        position:      'fixed',
        bottom:        '1.5rem',
        left:          '1.75rem',
        fontFamily:    'Menlo, "Courier New", monospace',
        fontSize:      '0.65rem',
        letterSpacing: '0.04em',
        lineHeight:    '1.9',
        pointerEvents: 'none',
        userSelect:    'none',
      }}>
        <div style={{ color: 'rgba(255,255,255,0.35)' }}>
          Hands:&nbsp;
          <span style={{ color: 'rgba(255,255,255,0.70)' }}>{handCount}</span>
        </div>
        <div style={{ color: 'rgba(255,255,255,0.35)' }}>
          Tracking:&nbsp;
          <span style={{ color: trackingColor, fontWeight: 600 }}>
            {trackingLabel}
          </span>
        </div>
        <div style={{ color: 'rgba(255,255,255,0.35)' }}>
          Gesture:&nbsp;
          <span style={{
            color: gesture === 'PINCH'
              ? 'rgba(255,220,80,0.90)'
              : 'rgba(255,255,255,0.55)',
            fontWeight: gesture === 'PINCH' ? 600 : 400,
          }}>
            {webcamOn ? gesture : '—'}
          </span>
        </div>
      </div>

      {/* ── Top-right HUD: FPS + webcam toggle ───────────────────────────── */}
      <div style={{
        position:      'fixed',
        top:           '1.5rem',
        right:         '1.75rem',
        display:       'flex',
        flexDirection: 'column',
        alignItems:    'flex-end',
        gap:           '0.55rem',
      }}>
        {/* FPS + GL version */}
        <span style={{
          fontFamily:    'Menlo, "Courier New", monospace',
          fontSize:      '0.7rem',
          color:         'rgba(255,255,255,0.35)',
          pointerEvents: 'none',
          userSelect:    'none',
          textAlign:     'right',
          lineHeight:    '1.6',
          whiteSpace:    'pre',
        }}>
          {fps} fps{glVersion ? `\n${glVersion}` : ''}
        </span>

        {/* Webcam toggle */}
        <button
          onClick={toggleWebcam}
          style={{
            fontFamily:    'Menlo, "Courier New", monospace',
            fontSize:      '0.65rem',
            letterSpacing: '0.06em',
            color:          webcamOn ? 'rgba(180,255,180,0.75)' : 'rgba(255,255,255,0.35)',
            background:    'transparent',
            border:        `1px solid ${webcamOn ? 'rgba(180,255,180,0.30)' : 'rgba(255,255,255,0.15)'}`,
            borderRadius:  '3px',
            padding:       '0.2rem 0.5rem',
            cursor:        'pointer',
            userSelect:    'none',
            transition:    'color 0.2s, border-color 0.2s',
          }}
        >
          WEBCAM: {webcamOn ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  );
}
