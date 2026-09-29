import { useRef } from "react";
import { Eraser } from "lucide-react";

export default function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) };
  };
  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    drawingRef.current = true;
    const { x, y } = point(event);
    ctx.beginPath(); ctx.moveTo(x, y);
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current; const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { x, y } = point(event);
    ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.strokeStyle = "#181a1c";
    ctx.lineTo(x, y); ctx.stroke();
    hasInkRef.current = true;
  };
  const end = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    onChange(hasInkRef.current ? canvasRef.current?.toDataURL("image/png") || null : null);
  };
  const clear = () => {
    const canvas = canvasRef.current; const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInkRef.current = false;
    onChange(null);
  };
  return <div className="signature-pad">
    <canvas ref={canvasRef} width={520} height={150} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} aria-label="Draw your signature here" />
    <button type="button" className="signature-clear" onClick={clear}><Eraser />Clear signature</button>
  </div>;
}
