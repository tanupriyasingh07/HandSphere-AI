/**
 * App.tsx
 * Root component. Owns the fullscreen canvas, WebGL context lifecycle,
 * animation loop, FPS counter, and HUD overlays.
 * Phase 2: single glowing particle rendered via the shader pipeline.
 */

import { useEffect, useRef, useState } from 'react';
import { initWebGL, setViewport, clearFrame, type AnyGL } from '@/lib/webgl';
import { createParticleRenderer, type ParticleRenderer } from '@/lib/particle';

export default function App() {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const glRef      = useRef<AnyGL | null>(null);
  const rafRef     = useRef<number>(0);
  const particleRef = useRef<ParticleRenderer | null>(null);

  const [fps,        setFps]        = useState(0);
  const [glVersion,  setGLVersion]  = useState<string>('');
  const [ctxLost,    setCtxLost]    = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // ── WebGL initialisation ──────────────────────────────────────────────
    const state = initWebGL(canvas);
    if (!state) {
      console.error('[App] Could not obtain a WebGL context.');
      return;
    }
    glRef.current = state.gl;
    setGLVersion(`WebGL${state.version}`);

    // ── Particle renderer ─────────────────────────────────────────────────
    particleRef.current = createParticleRenderer(state.gl);

    // ── Resize handler ────────────────────────────────────────────────────
    const resize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      if (glRef.current) {
        setViewport(glRef.current, canvas.width, canvas.height);
      }
    };
    resize(); // set dimensions immediately
    window.addEventListener('resize', resize);

    // ── Context-loss handling ─────────────────────────────────────────────
    const onContextLost = (e: Event) => {
      e.preventDefault(); // required so the browser can restore the context
      setCtxLost(true);
      cancelAnimationFrame(rafRef.current);
      console.warn('[WebGL] Context lost.');
    };

    const onContextRestored = () => {
      setCtxLost(false);
      console.info('[WebGL] Context restored — reinitialising.');
      const restored = initWebGL(canvas);
      if (restored) {
        glRef.current     = restored.gl;
        particleRef.current = createParticleRenderer(restored.gl);
        resize();
        startLoop();
      }
    };

    canvas.addEventListener('webglcontextlost',     onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    // ── Animation loop ────────────────────────────────────────────────────
    const startTime = performance.now(); // t=0 for u_time uniform
    let lastTime    = startTime;
    let frameCount  = 0;
    let fpsAccum    = 0; // accumulated ms since last FPS sample

    const loop = (now: number) => {
      const delta      = now - lastTime;
      lastTime         = now;
      const timeSec    = (now - startTime) / 1000; // seconds elapsed

      // FPS sampling — update display every 500 ms
      frameCount++;
      fpsAccum += delta;
      if (fpsAccum >= 500) {
        setFps(Math.round((frameCount * 1000) / fpsAccum));
        frameCount = 0;
        fpsAccum   = 0;
      }

      // ── Render ────────────────────────────────────────────────────────
      if (glRef.current) {
        clearFrame(glRef.current);                    // fill with #050505
        particleRef.current?.draw(timeSec);           // single glowing particle
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

    // ── Cleanup ───────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(rafRef.current);
      particleRef.current?.dispose();
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('webglcontextlost',     onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
    };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#050505' }}>
      {/* WebGL canvas — fills the entire viewport */}
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />

      {/* Context-loss warning — only visible when GL context is lost */}
      {ctxLost && (
        <div style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(255,100,100,0.8)',
          fontFamily: 'Menlo, monospace',
          fontSize: '0.75rem',
          pointerEvents: 'none',
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
        fontWeight:    400,
        letterSpacing: '0.04em',
        color:         'rgba(255,255,255,0.88)',
        pointerEvents: 'none',
        userSelect:    'none',
      }}>
        HandSphere AI
      </span>

      {/* FPS counter + GL version — top right */}
      <span style={{
        position:      'fixed',
        top:           '1.5rem',
        right:         '1.75rem',
        fontFamily:    'Menlo, "Courier New", monospace',
        fontSize:      '0.7rem',
        color:         'rgba(255,255,255,0.35)',
        pointerEvents: 'none',
        userSelect:    'none',
        textAlign:     'right',
        lineHeight:    '1.6',
      }}>
        {fps} fps{glVersion ? `\n${glVersion}` : ''}
      </span>
    </div>
  );
}
