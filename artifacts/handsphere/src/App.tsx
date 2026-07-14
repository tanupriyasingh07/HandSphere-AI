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

  // ── UI state ──────────────────────────────────────────────────────────────
  const [fps,       setFps]       = useState(0);
  const [glVersion, setGLVersion] = useState<string>('');
  const [ctxLost,   setCtxLost]   = useState(false);
  const [webcamOn,  setWebcamOn]  = useState(false);
  const [handCount, setHandCount] = useState(0);

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

      // ── WebGL: clear + particles ─────────────────────────────────────
      if (glRef.current) {
        clearFrame(glRef.current);
        particleRef.current?.draw(timeSec);
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
          setHandCount(results.multiHandLandmarks?.length ?? 0);
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
