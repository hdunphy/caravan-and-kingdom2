// Pan/zoom camera for the canvas map.
export function makeCamera(canvas: HTMLCanvasElement) {
  const cam: any = { x: 0, y: 0, zoom: 1.0, dragging: false, lastX: 0, lastY: 0, moved: false };

  canvas.addEventListener('mousedown', e => {
    cam.dragging = true; cam.moved = false;
    cam.lastX = e.clientX; cam.lastY = e.clientY;
  });
  window.addEventListener('mouseup', () => { cam.dragging = false; });
  window.addEventListener('mousemove', e => {
    if (!cam.dragging) return;
    const dx = e.clientX - cam.lastX, dy = e.clientY - cam.lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) cam.moved = true;
    cam.x -= dx / cam.zoom;
    cam.y -= dy / cam.zoom;
    cam.lastX = e.clientX; cam.lastY = e.clientY;
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    cam.zoom = Math.max(0.3, Math.min(4, cam.zoom * factor));
  }, { passive: false });

  cam.screenToWorld = (sx: number, sy: number) => ({
    x: (sx - canvas.width / 2) / cam.zoom + cam.x,
    y: (sy - canvas.height / 2) / cam.zoom + cam.y,
  });
  return cam;
}
