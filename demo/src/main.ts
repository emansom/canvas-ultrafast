import { UltrafastRenderer } from 'canvas-ultrafast';

interface CanvasButton {
  label: string;
  x: number; y: number; width: number; height: number;
  action: () => void;
}

const pageCanvas = document.getElementById('canvas') as HTMLCanvasElement;
if (!pageCanvas) throw new Error('Canvas element not found');

function initializeDemo() {
  const renderer = new UltrafastRenderer(pageCanvas);
  const ctx = renderer.getCanvasAPI();

  let animationRunning = false;
  let animationStartTime = 0;
  let rafId: number | null = null;

  const buttons: CanvasButton[] = [
    { label: 'Draw Static',     x: 20, y: 60,  width: 150, height: 40, action: () => { stopAnimation(); renderStaticUI(); } },
    { label: 'Start Animation', x: 20, y: 120, width: 150, height: 40, action: startAnimation },
    { label: 'Stop Animation',  x: 20, y: 180, width: 150, height: 40, action: stopAnimation },
  ];

  function drawButtons() {
    for (const btn of buttons) {
      ctx.fillStyle = 'rgba(74, 158, 255, 0.9)';
      ctx.fillRect(btn.x, btn.y, btn.width, btn.height);
      ctx.fillStyle = '#ffffff';
      ctx.font = '13px monospace';
      ctx.fillText(btn.label, btn.x + 10, btn.y + 26);
    }
  }

  function renderStaticUI() {
    const { width, height } = renderer.getCanvasSize();
    ctx.fillStyle = '#1a1a2a';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('Canvas Ultrafast Demo', 20, 35);
    drawButtons();
  }

  function renderAnimation() {
    if (!animationRunning) return;
    const { width, height } = renderer.getCanvasSize();
    const elapsed = performance.now() - animationStartTime;

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);

    // Pulsing green rectangle
    const alpha = Math.abs(Math.sin((elapsed / 1000) * Math.PI));
    ctx.fillStyle = `rgba(0, 255, 136, ${alpha * 0.8})`;
    ctx.fillRect(200, 60, 100, 100);

    // Rotating magenta square
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate((elapsed / 1000) * Math.PI);
    ctx.strokeStyle = '#ff00ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(-50, -50, 100, 100);
    ctx.restore();

    // Orange sine wave
    ctx.strokeStyle = '#ffaa00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x < width; x += 5) {
      const y = height / 2 + Math.sin((x + elapsed / 10) / 30) * 50;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    drawButtons();

    // Schedule next frame via RAF — canvas-ultrafast auto-flushes commands
    rafId = requestAnimationFrame(renderAnimation);
  }

  function startAnimation() {
    if (animationRunning) return;
    animationRunning = true;
    animationStartTime = performance.now();
    rafId = requestAnimationFrame(renderAnimation);
  }

  function stopAnimation() {
    animationRunning = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function handleCanvasClick(e: MouseEvent) {
    const rect = pageCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    for (const btn of buttons) {
      if (x >= btn.x && x <= btn.x + btn.width && y >= btn.y && y <= btn.y + btn.height) {
        btn.action();
        break;
      }
    }
  }

  function handleCanvasMouseMove(e: MouseEvent) {
    const rect = pageCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const overButton = buttons.some(
      btn => x >= btn.x && x <= btn.x + btn.width && y >= btn.y && y <= btn.y + btn.height
    );
    pageCanvas.style.cursor = overButton ? 'pointer' : 'default';
  }

  pageCanvas.addEventListener('click', handleCanvasClick);
  pageCanvas.addEventListener('mousemove', handleCanvasMouseMove);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (animationRunning) stopAnimation();
    }
  });

  renderStaticUI();
}

initializeDemo();
