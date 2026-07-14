/**
 * App.tsx
 * Root component. Owns the fullscreen canvas, WebGL context lifecycle,
 * animation loop, FPS counter, HUD overlays, and webcam layer.
 *
 * Webcam design note:
 *   The WebGL canvas sits above the video element and uses
 *   mix-blend-mode: screen.  The WebGL clear colour is #050505 (≈0.02).
 *   screen(0.02, video) ≈ video → the video shows through the dark background.
 *   screen(bright, video) → particles glow on top of the feed.
 *   No changes to the WebGL pipeline are required.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { initWebGL, setViewport, clearFrame, type AnyGL } from '@/lib/webgl';
import { createParticleRenderer, type ParticleRenderer } from '@/lib/particle';

export default function App() {
  // ── WebGL refs ────────────────────────────────────────────────────────────
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const glRef       = useRef<AnyGL | null>(null);
  const rafRef      = useRef<number>(0);
  const particleRef = useRef<ParticleRenderer | null>(null);

  // ── Webcam refs ───────────────────────────────────────────────────────────
  const videoRef  = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [fps,       setFps]       = useState(0);
  const [glVersion, setGLVersion] = useState<string>('');
  const [ctxLost,   setCtxLost]   = useState(false);
  const [webcamOn,  setWebcamOn]  = useState(false);

  // ── WebGL lifecycle ───────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // ── WebGL initialisation ────────────────────────────────────────────
    const state = initWebGL(canvas);
    if (!state) {
      console.error('[App] Could not obtain a WebGL context.');
      return;
    }
    glRef.current = state.gl;
    setGLVersion(`WebGL${state.version}`);

    // ── Particle renderer ───────────────────────────────────────────────
    particleRef.current = createParticleRenderer(state.gl);

    // ── Resize handler ──────────────────────────────────────────────────
    const resize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      if (glRef.current) setViewport(glRef.current, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener('resize', resize);

    // ── Context-loss handling ───────────────────────────────────────────
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

    // ── Animation loop ──────────────────────────────────────────────────
    const startTime = performance.now();
    let lastTime    = startTime;
    let frameCount  = 0;
    let fpsAccum    = 0;

    const loop = (now: number) => {
      const delta   = now - lastTime;
      lastTime      = now;
      const timeSec = (now - startTime) / 1000;

      frameCount++;
      fpsAccum += delta;
      if (fpsAccum >= 500) {
        setFps(Math.round((frameCount * 1000) / fpsAccum));
        frameCount = 0;
        fpsAccum   = 0;
      }

      if (glRef.current) {
        clearFrame(glRef.current);
        particleRef.current?.draw(timeSec);
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

  // ── Webcam cleanup on unmount ─────────────────────────────────────────────
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  // ── Webcam toggle ─────────────────────────────────────────────────────────
  const toggleWebcam = useCallback(async () => {
    if (!webcamOn) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setWebcamOn(true);
      } catch (err) {
        console.warn('[webcam] Permission denied or device unavailable:', err);
      }
    } else {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setWebcamOn(false);
    }
  }, [webcamOn]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#050505' }}>

      {/* ── Webcam video — behind everything ──────────────────────────────
          Covers the full viewport. Hidden (visibility, not display) when off
          so the element stays mounted and the srcObject assignment is safe.   */}
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
          // Mirror the feed so the user sees themselves correctly.
          transform:  'scaleX(-1)',
          visibility:  webcamOn ? 'visible' : 'hidden',
        }}
      />

      {/* ── WebGL canvas ───────────────────────────────────────────────────
          mix-blend-mode: screen lets the webcam show through the near-black
          (#050505) WebGL clear colour while particle glows add on top.        */}
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

      {/* Context-loss warning */}
      {ctxLost && (
        <div style={{
          position:       'fixed',
          inset:           0,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          color:          'rgba(255,100,100,0.8)',
          fontFamily:     'Menlo, monospace',
          fontSize:       '0.75rem',
          pointerEvents:  'none',
        }}>
          WebGL context lost — waiting for restore…
        </div>
      )}

      {/* Title — top left */}
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
        {/* FPS counter */}
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

        {/* Webcam toggle button */}
        <button
          onClick={toggleWebcam}
          style={{
            fontFamily:      'Menlo, "Courier New", monospace',
            fontSize:        '0.65rem',
            letterSpacing:   '0.06em',
            color:            webcamOn ? 'rgba(180,255,180,0.75)' : 'rgba(255,255,255,0.35)',
            background:      'transparent',
            border:          `1px solid ${webcamOn ? 'rgba(180,255,180,0.30)' : 'rgba(255,255,255,0.15)'}`,
            borderRadius:    '3px',
            padding:         '0.2rem 0.5rem',
            cursor:          'pointer',
            userSelect:      'none',
            transition:      'color 0.2s, border-color 0.2s',
          }}
        >
          WEBCAM: {webcamOn ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  );
}
