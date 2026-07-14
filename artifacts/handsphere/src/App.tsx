import { useEffect, useRef, useState } from 'react';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let lastTime = performance.now();
    let frameCount = 0;
    let fpsInterval = 0;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const render = (now: number) => {
      const delta = now - lastTime;
      lastTime = now;

      frameCount++;
      fpsInterval += delta;
      if (fpsInterval >= 500) {
        setFps(Math.round((frameCount * 1000) / fpsInterval));
        frameCount = 0;
        fpsInterval = 0;
      }

      // Empty render loop — fill background only
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      animationId = requestAnimationFrame(render);
    };

    resize();
    window.addEventListener('resize', resize);
    animationId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#050505' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />

      {/* Title — top left */}
      <span
        style={{
          position: 'fixed',
          top: '1.5rem',
          left: '1.75rem',
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: '1.25rem',
          fontWeight: 400,
          letterSpacing: '0.04em',
          color: 'rgba(255, 255, 255, 0.88)',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        HandSphere AI
      </span>

      {/* FPS counter — top right */}
      <span
        style={{
          position: 'fixed',
          top: '1.5rem',
          right: '1.75rem',
          fontFamily: 'Menlo, "Courier New", monospace',
          fontSize: '0.7rem',
          color: 'rgba(255, 255, 255, 0.35)',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        {fps} fps
      </span>
    </div>
  );
}
