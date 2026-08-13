import React, { useRef, useState, useEffect } from 'react';
import {
  Undo2, Redo2, Trash2, Type, Circle, ArrowUpRight, PenTool, Eraser, Check, Eye, EyeOff, Move, Minimize2
} from 'lucide-react';

interface Point { x: number; y: number; }

interface Stroke {
  id: string;
  type: 'pen' | 'line' | 'arrow' | 'circle' | 'eraser';
  color: string;
  width: number;
  points: Point[];
}

interface TextNote {
  id: string;
  text: string;
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  color: string;
}

interface AcademyPlanningCanvasProps {
  imageUrl: string;
  onSavePlanning: (drawingsJson: string, base64ImageOverlay?: string) => void;
  initialDrawingsJson?: string;
  onClose?: () => void;
}

// Reusable drawing/annotation canvas — used both by the professor (drawing the
// "gabarito" over an approved student case) and by the student (annotating
// their own approved case). Ported from the legacy education module's
// InteractivePlanningCanvas; drawing logic kept as-is (it's solid), visual
// language adapted to the Next dark/purple design system.
export default function AcademyPlanningCanvas({
  imageUrl, onSavePlanning, initialDrawingsJson, onClose
}: AcademyPlanningCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const [activeTool, setActiveTool] = useState<'pen' | 'line' | 'arrow' | 'circle' | 'text' | 'eraser'>('pen');
  const [color, setColor] = useState<string>('#f43f5e');
  const [lineWidth, setLineWidth] = useState<number>(3);
  const [isDrawingVisibilityActive, setIsDrawingVisibilityActive] = useState<boolean>(true);
  const [isComparingWithOriginal, setIsComparingWithOriginal] = useState<boolean>(false);

  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoHistory, setRedoHistory] = useState<Stroke[]>([]);
  const [textNotes, setTextNotes] = useState<TextNote[]>([]);
  const [redoTextHistory, setRedoTextHistory] = useState<TextNote[]>([]);
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);

  const [textInputPending, setTextInputPending] = useState<{ x: number; y: number } | null>(null);
  const [textInputValue, setTextInputValue] = useState<string>('');

  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const colorPalette = [
    { value: '#f43f5e', name: 'Rosa' },
    { value: '#eab308', name: 'Amarelo' },
    { value: '#06b6d4', name: 'Ciano' },
    { value: '#10b981', name: 'Limão' },
    { value: '#a855f7', name: 'Roxo' },
    { value: '#ffffff', name: 'Branco' },
  ];

  const updateCanvasSize = () => {
    if (imageRef.current && canvasRef.current) {
      const rect = imageRef.current.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      setDimensions({ width, height });
      canvasRef.current.width = width;
      canvasRef.current.height = height;
      drawCanvasContent(width, height);
    }
  };

  useEffect(() => {
    window.addEventListener('resize', updateCanvasSize);
    return () => window.removeEventListener('resize', updateCanvasSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, textNotes, isDrawingVisibilityActive, isComparingWithOriginal]);

  useEffect(() => {
    if (initialDrawingsJson) {
      try {
        const parsed = JSON.parse(initialDrawingsJson);
        if (parsed.strokes) setStrokes(parsed.strokes);
        if (parsed.textNotes) setTextNotes(parsed.textNotes);
      } catch (e) {
        console.error('Failed to parse initial planning drawings data:', e);
      }
    }
  }, [initialDrawingsJson]);

  const handleImageLoad = () => { setTimeout(updateCanvasSize, 100); };

  const drawCanvasContent = (w = dimensions.width, h = dimensions.height) => {
    const canvas = canvasRef.current;
    if (!canvas || w === 0 || h === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);
    if (!isDrawingVisibilityActive || isComparingWithOriginal) return;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const renderStroke = (stroke: Stroke) => {
      if (stroke.points.length === 0) return;
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;

      if (stroke.type === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
      }

      const firstPoint = stroke.points[0];
      ctx.moveTo(firstPoint.x * w, firstPoint.y * h);

      if (stroke.type === 'pen' || stroke.type === 'eraser') {
        for (let i = 1; i < stroke.points.length; i++) {
          const pt = stroke.points[i];
          ctx.lineTo(pt.x * w, pt.y * h);
        }
        ctx.stroke();
      } else if (stroke.type === 'line') {
        if (stroke.points.length >= 2) {
          const endPt = stroke.points[stroke.points.length - 1];
          ctx.lineTo(endPt.x * w, endPt.y * h);
          ctx.stroke();
        }
      } else if (stroke.type === 'arrow') {
        if (stroke.points.length >= 2) {
          const startPt = stroke.points[0];
          const endPt = stroke.points[stroke.points.length - 1];
          const sx = startPt.x * w, sy = startPt.y * h, ex = endPt.x * w, ey = endPt.y * h;
          ctx.moveTo(sx, sy);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          const angle = Math.atan2(ey - sy, ex - sx);
          const headLength = Math.max(10, stroke.width * 3.5);
          ctx.beginPath();
          ctx.fillStyle = stroke.color;
          ctx.globalCompositeOperation = 'source-over';
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex - headLength * Math.cos(angle - Math.PI / 6), ey - headLength * Math.sin(angle - Math.PI / 6));
          ctx.lineTo(ex - headLength * Math.cos(angle + Math.PI / 6), ey - headLength * Math.sin(angle + Math.PI / 6));
          ctx.closePath();
          ctx.fill();
        }
      } else if (stroke.type === 'circle') {
        if (stroke.points.length >= 2) {
          const startPt = stroke.points[0];
          const endPt = stroke.points[stroke.points.length - 1];
          const sx = startPt.x * w, sy = startPt.y * h, ex = endPt.x * w, ey = endPt.y * h;
          const radius = Math.sqrt(Math.pow(ex - sx, 2) + Math.pow(ey - sy, 2));
          ctx.arc(sx, sy, radius, 0, 2 * Math.PI);
          ctx.stroke();
        }
      }
    };

    strokes.forEach(renderStroke);
    if (currentStroke) renderStroke(currentStroke);
    ctx.globalCompositeOperation = 'source-over';

    textNotes.forEach(note => {
      ctx.font = 'bold 13px Inter, sans-serif';
      const tx = note.x * w, ty = note.y * h;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      const measure = ctx.measureText(note.text);
      const textW = measure.width, textH = 14;
      ctx.beginPath();
      ctx.roundRect(tx - 6, ty - textH - 4, textW + 12, textH + 10, 6);
      ctx.fill();
      ctx.fillStyle = note.color;
      ctx.fillText(note.text, tx, ty);
    });
  };

  useEffect(() => {
    drawCanvasContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, currentStroke, textNotes, isDrawingVisibilityActive, isComparingWithOriginal, dimensions]);

  const getNormalizedPoint = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getNormalizedPoint(e);
    if (activeTool === 'text') {
      setTextInputPending({ x: pt.x, y: pt.y });
      setTextInputValue('');
      return;
    }
    const strokeId = 'stroke_' + Math.random().toString(36).substr(2, 9);
    const newStroke: Stroke = { id: strokeId, type: activeTool === 'eraser' ? 'eraser' : (activeTool as any), color, width: lineWidth, points: [pt] };
    setCurrentStroke(newStroke);
    setRedoHistory([]);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!currentStroke) return;
    const pt = getNormalizedPoint(e);
    let updatedPoints = [...currentStroke.points];
    if (currentStroke.type === 'pen' || currentStroke.type === 'eraser') {
      updatedPoints.push(pt);
    } else {
      if (updatedPoints.length > 1) updatedPoints[1] = pt;
      else updatedPoints.push(pt);
    }
    setCurrentStroke({ ...currentStroke, points: updatedPoints });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!currentStroke) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setStrokes([...strokes, currentStroke]);
    setCurrentStroke(null);
  };

  const handleCreateTextNote = () => {
    if (!textInputPending || !textInputValue.trim()) { setTextInputPending(null); return; }
    const noteId = 'note_' + Math.random().toString(36).substr(2, 9);
    const newNote: TextNote = { id: noteId, text: textInputValue.trim(), x: textInputPending.x, y: textInputPending.y, color };
    setTextNotes([...textNotes, newNote]);
    setTextInputPending(null);
    setTextInputValue('');
    setRedoTextHistory([]);
  };

  const handleUndo = () => {
    if (activeTool === 'text' && textNotes.length > 0) {
      const remaining = [...textNotes];
      const undone = remaining.pop();
      if (undone) { setTextNotes(remaining); setRedoTextHistory([...redoTextHistory, undone]); }
    } else if (strokes.length > 0) {
      const remaining = [...strokes];
      const undone = remaining.pop();
      if (undone) { setStrokes(remaining); setRedoHistory([...redoHistory, undone]); }
    }
  };

  const handleRedo = () => {
    if (activeTool === 'text' && redoTextHistory.length > 0) {
      const remainingHistory = [...redoTextHistory];
      const redone = remainingHistory.pop();
      if (redone) { setTextNotes([...textNotes, redone]); setRedoTextHistory(remainingHistory); }
    } else if (redoHistory.length > 0) {
      const remainingHistory = [...redoHistory];
      const redone = remainingHistory.pop();
      if (redone) { setStrokes([...strokes, redone]); setRedoHistory(remainingHistory); }
    }
  };

  const handleWipeCanvas = () => {
    if (confirm('Deseja realmente limpar todos os desenhos deste planejamento?')) {
      setStrokes([]); setRedoHistory([]); setTextNotes([]); setRedoTextHistory([]);
    }
  };

  const handleCommitSave = () => {
    const serialized = JSON.stringify({ strokes, textNotes });
    let base64Overlay: string | undefined;
    if (canvasRef.current) {
      try { base64Overlay = canvasRef.current.toDataURL('image/png'); }
      catch (e) { console.warn('Base64 layer extraction failed:', e); }
    }
    onSavePlanning(serialized, base64Overlay);
  };

  return (
    <div className="bg-slate-950 border border-next-border rounded-3xl p-4 sm:p-6 w-full flex flex-col items-center justify-between gap-6 overflow-hidden">
      <header className="w-full flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-next-border pb-4 select-none shrink-0 text-left">
        <div className="space-y-0.5">
          <h4 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 bg-next-purple-neon rounded-full animate-ping" />
            Editor de Planejamento Ativo
          </h4>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Caneta digital, touchscreen ou mouse</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={handleUndo} disabled={strokes.length === 0 && textNotes.length === 0} className="p-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 rounded-xl transition-all" title="Desfazer">
            <Undo2 className="w-4 h-4" />
          </button>
          <button type="button" onClick={handleRedo} disabled={redoHistory.length === 0 && redoTextHistory.length === 0} className="p-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 rounded-xl transition-all" title="Refazer">
            <Redo2 className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => setIsDrawingVisibilityActive(v => !v)} className={`p-2.5 rounded-xl transition-all flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest ${isDrawingVisibilityActive ? 'bg-slate-800 text-next-purple-light' : 'bg-slate-950 text-slate-500 border border-next-border'}`}>
            {isDrawingVisibilityActive ? (<><Eye className="w-4 h-4" /> Exibindo</>) : (<><EyeOff className="w-4 h-4" /> Ocultos</>)}
          </button>
          <button type="button" onMouseDown={() => setIsComparingWithOriginal(true)} onMouseUp={() => setIsComparingWithOriginal(false)} onTouchStart={() => setIsComparingWithOriginal(true)} onTouchEnd={() => setIsComparingWithOriginal(false)} className="p-2 px-3.5 bg-next-red-alert/10 hover:bg-next-red-alert/20 border border-next-red-alert/20 text-next-red-alert rounded-xl text-[10px] font-black uppercase tracking-widest transition-all" title="Segure para comparar com o original">
            Comparar com Original
          </button>
          <button type="button" onClick={handleWipeCanvas} className="p-2.5 bg-next-red-alert/10 text-next-red-alert border border-next-red-alert/20 hover:bg-next-red-alert/20 rounded-xl transition-all" title="Limpar Tudo">
            <Trash2 className="w-4 h-4" />
          </button>
          {onClose && (
            <button type="button" onClick={onClose} className="p-2.5 bg-slate-950 text-slate-400 hover:text-slate-200 border border-next-border rounded-xl" title="Fechar Editor">
              <Minimize2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      <div className="w-full flex-grow flex flex-col lg:flex-row gap-6 relative justify-center items-stretch min-h-[450px]">
        <div className="w-full lg:w-48 bg-slate-950 border border-next-border p-4 rounded-2xl flex flex-col gap-4 text-left select-none shrink-0">
          <div>
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-2">Ferramenta Ativa</span>
            <div className="grid grid-cols-3 lg:grid-cols-2 gap-1.5">
              {[
                { id: 'pen', label: 'Pincel', icon: PenTool },
                { id: 'line', label: 'Linha', icon: Move },
                { id: 'arrow', label: 'Seta', icon: ArrowUpRight },
                { id: 'circle', label: 'Círculo', icon: Circle },
                { id: 'text', label: 'Texto', icon: Type },
                { id: 'eraser', label: 'Borracha', icon: Eraser },
              ].map(t => {
                const isActive = activeTool === t.id;
                return (
                  <button key={t.id} type="button" onClick={() => { setActiveTool(t.id as any); setTextInputPending(null); }} className={`py-3 px-1 rounded-xl transition-all flex flex-col items-center justify-center gap-1.5 ${isActive ? 'next-brand-gradient-bg text-white shadow-next-glow-purple' : 'bg-slate-900 text-slate-400 hover:text-slate-200'}`}>
                    <t.icon className="w-4 h-4 shrink-0" />
                    <span className="text-[8px] font-black uppercase tracking-widest">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-2">Espessura</span>
            <div className="flex gap-2">
              {[2, 3, 5, 8].map(w => (
                <button key={w} type="button" onClick={() => setLineWidth(w)} className={`flex-1 py-1.5 text-[9px] font-black text-slate-300 rounded border transition-all ${lineWidth === w ? 'bg-slate-800 border-next-purple-neon' : 'bg-slate-900 border-next-border'}`}>
                  {w}px
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Cor</span>
            <div className="grid grid-cols-6 gap-2">
              {colorPalette.map(c => (
                <button key={c.value} type="button" onClick={() => setColor(c.value)} className={`w-full aspect-square rounded-lg border-2 relative ${color === c.value ? 'border-next-purple-neon scale-105' : 'border-transparent'}`} style={{ backgroundColor: c.value }} title={c.name}>
                  {color === c.value && <span className="absolute inset-0 m-auto w-1 h-1 bg-slate-950 rounded-full" />}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div ref={containerRef} className="flex-1 bg-slate-950/80 rounded-2xl border border-next-border flex items-center justify-center relative overflow-hidden p-2">
          <div className="relative inline-block overflow-hidden max-w-full max-h-[65vh]">
            <img ref={imageRef} src={imageUrl} alt="Caso clínico" onLoad={handleImageLoad} referrerPolicy="no-referrer" className="object-contain block max-w-full max-h-[65vh] rounded-xl pointer-events-none" />
            <canvas ref={canvasRef} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} className={`absolute inset-0 w-full h-full cursor-crosshair z-10 select-none ${isComparingWithOriginal ? 'opacity-0' : 'opacity-100'}`} style={{ touchAction: 'none' }} />
            {textInputPending && (
              <div className="absolute z-20 flex flex-col gap-1.5 p-3 bg-slate-950 border border-next-border rounded-xl shadow-2xl max-w-[200px]" style={{ left: `${textInputPending.x * 100}%`, top: `${textInputPending.y * 100}%`, transform: 'translate(-50%, -100%)' }}>
                <input type="text" value={textInputValue} onChange={(e) => setTextInputValue(e.target.value)} placeholder="Escrever notas..." autoFocus onKeyDown={(e) => { if (e.key === 'Enter') handleCreateTextNote(); if (e.key === 'Escape') setTextInputPending(null); }} className="w-full px-2 py-1.5 bg-slate-900 text-white rounded border border-next-border text-xs font-semibold outline-none" />
                <div className="flex gap-1">
                  <button onClick={handleCreateTextNote} className="flex-1 px-2 py-1 next-brand-gradient-bg text-white rounded text-[8.5px] font-black uppercase tracking-wider">Confirmar</button>
                  <button onClick={() => setTextInputPending(null)} className="px-2 py-1 bg-slate-800 text-slate-400 rounded text-[8.5px] font-black uppercase tracking-wider">Sair</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className="w-full flex justify-end gap-3 border-t border-next-border pt-4 shrink-0">
        <button type="button" onClick={handleCommitSave} className="px-6 py-3 next-brand-gradient-bg text-white font-black uppercase tracking-widest text-xs rounded-xl shadow-next-glow-purple transition-all flex items-center gap-2">
          <Check className="w-4 h-4" /> Salvar Planejamento
        </button>
      </footer>
    </div>
  );
}
