import React, { useRef, useState, useEffect } from 'react';
import { 
  Undo2, 
  Redo2, 
  Trash2, 
  Type, 
  Circle, 
  ArrowUpRight, 
  PenTool, 
  Eraser, 
  Check, 
  Eye, 
  EyeOff,
  Move,
  Minimize2
} from 'lucide-react';

interface Point {
  x: number;
  y: number;
}

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

interface InteractivePlanningCanvasProps {
  imageUrl: string;
  onSavePlanning: (drawingsJson: string, base64ImageOverlay?: string) => void;
  initialDrawingsJson?: string;
  onClose?: () => void;
}

export default function InteractivePlanningCanvas({
  imageUrl,
  onSavePlanning,
  initialDrawingsJson,
  onClose
}: InteractivePlanningCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Tools states
  const [activeTool, setActiveTool] = useState<'pen' | 'line' | 'arrow' | 'circle' | 'text' | 'eraser'>('pen');
  const [color, setColor] = useState<string>('#f43f5e'); // rose-500 default for clinical contrast
  const [lineWidth, setLineWidth] = useState<number>(3);
  const [isDrawingVisibilityActive, setIsDrawingVisibilityActive] = useState<boolean>(true);
  const [isComparingWithOriginal, setIsComparingWithOriginal] = useState<boolean>(false);

  // Drawing state
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoHistory, setRedoHistory] = useState<Stroke[]>([]);
  const [textNotes, setTextNotes] = useState<TextNote[]>([]);
  const [redoTextHistory, setRedoTextHistory] = useState<TextNote[]>([]);
  
  // Active stroke drawing
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);

  // Text inputs pending creation
  const [textInputPending, setTextInputPending] = useState<{ x: number; y: number } | null>(null);
  const [textInputValue, setTextInputValue] = useState<string>('');

  // Sizing and alignment
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Color options
  const colorPalette = [
    { value: '#f43f5e', name: 'Rosa' },
    { value: '#eab308', name: 'Amarelo' },
    { value: '#06b6d4', name: 'Ciano' },
    { value: '#10b981', name: 'Limão' },
    { value: '#a855f7', name: 'Roxo' },
    { value: '#ffffff', name: 'Branco' }
  ];

  // Re-calculate dimensions when image loads or container resizes
  const updateCanvasSize = () => {
    if (imageRef.current && canvasRef.current) {
      const rect = imageRef.current.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      
      setDimensions({ width, height });

      // Match canvas backing store size to element size
      canvasRef.current.width = width;
      canvasRef.current.height = height;

      drawCanvasContent(width, height);
    }
  };

  useEffect(() => {
    window.addEventListener('resize', updateCanvasSize);
    return () => window.removeEventListener('resize', updateCanvasSize);
  }, [strokes, textNotes, isDrawingVisibilityActive, isComparingWithOriginal]);

  // Load initial drawings if present
  useEffect(() => {
    if (initialDrawingsJson) {
      try {
        const parsed = JSON.parse(initialDrawingsJson);
        if (parsed.strokes) setStrokes(parsed.strokes);
        if (parsed.textNotes) setTextNotes(parsed.textNotes);
      } catch (e) {
        console.error("Failed to parse initial planning drawings data:", e);
      }
    }
  }, [initialDrawingsJson]);

  // Hook triggered when image source loads completely
  const handleImageLoad = () => {
    setTimeout(updateCanvasSize, 100);
  };

  // Main canvas redraw loop
  const drawCanvasContent = (w = dimensions.width, h = dimensions.height) => {
    const canvas = canvasRef.current;
    if (!canvas || w === 0 || h === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear transparent layer
    ctx.clearRect(0, 0, w, h);

    if (!isDrawingVisibilityActive || isComparingWithOriginal) {
      return; 
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const renderStroke = (stroke: Stroke) => {
      if (stroke.points.length === 0) return;
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;

      // Handle transparent eraser blends
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
          const sx = startPt.x * w;
          const sy = startPt.y * h;
          const ex = endPt.x * w;
          const ey = endPt.y * h;

          ctx.moveTo(sx, sy);
          ctx.lineTo(ex, ey);
          ctx.stroke();

          // Arrowhead trigonometry
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
          const sx = startPt.x * w;
          const sy = startPt.y * h;
          const ex = endPt.x * w;
          const ey = endPt.y * h;

          // Calculate radius as Euclidean distance
          const radius = Math.sqrt(Math.pow(ex - sx, 2) + Math.pow(ey - sy, 2));

          ctx.arc(sx, sy, radius, 0, 2 * Math.PI);
          ctx.stroke();
        }
      }
    };

    // Draw all completed strokes
    strokes.forEach(renderStroke);

    // Draw current in-progress stroke if drawing
    if (currentStroke) {
      renderStroke(currentStroke);
    }

    // Always reset composite rendering mode
    ctx.globalCompositeOperation = 'source-over';

    // Render Text Notes using standard clean typography overlays
    textNotes.forEach(note => {
      ctx.font = 'bold 13px Inter, sans-serif';
      ctx.fillStyle = note.color;
      
      const tx = note.x * w;
      const ty = note.y * h;

      // Draw standard text background padding container for enhanced contrast readability
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      const measure = ctx.measureText(note.text);
      const textW = measure.width;
      const textH = 14;

      // Card bounding bubble
      ctx.beginPath();
      ctx.roundRect(tx - 6, ty - textH - 4, textW + 12, textH + 10, 6);
      ctx.fill();

      // Literal text print
      ctx.fillStyle = note.color;
      ctx.fillText(note.text, tx, ty);
    });
  };

  // Trigger repaint whenever shape vectors mutate
  useEffect(() => {
    drawCanvasContent();
  }, [strokes, currentStroke, textNotes, isDrawingVisibilityActive, isComparingWithOriginal, dimensions]);

  // Calculate coordinates relative to canvas positioning normalized to 0..1 range
  const getNormalizedPoint = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y))
    };
  };

  // Pointer downs initiate drawings
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Avoid double activations
    e.currentTarget.setPointerCapture(e.pointerId);

    const pt = getNormalizedPoint(e);

    if (activeTool === 'text') {
      setTextInputPending({ x: pt.x, y: pt.y });
      setTextInputValue('');
      return;
    }

    const strokeId = 'stroke_' + Math.random().toString(36).substr(2, 9);
    const newStroke: Stroke = {
      id: strokeId,
      type: activeTool === 'eraser' ? 'eraser' : activeTool as any,
      color: color,
      width: lineWidth,
      points: [pt]
    };

    setCurrentStroke(newStroke);
    // Clear redo buffers upon new operations
    setRedoHistory([]);
  };

  // Pointer drag keeps capturing path nodes
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!currentStroke) return;
    const pt = getNormalizedPoint(e);

    let updatedPoints = [...currentStroke.points];
    if (currentStroke.type === 'pen' || currentStroke.type === 'eraser') {
      updatedPoints.push(pt);
    } else {
      // Lines, arrows, circles only track the starting vector node and active dragging node
      if (updatedPoints.length > 1) {
        updatedPoints[1] = pt; // replace drag node
      } else {
        updatedPoints.push(pt);
      }
    }

    setCurrentStroke({
      ...currentStroke,
      points: updatedPoints
    });
  };

  // Pointer releases commit strokes to standard collection array
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!currentStroke) return;
    e.currentTarget.releasePointerCapture(e.pointerId);

    setStrokes([...strokes, currentStroke]);
    setCurrentStroke(null);
  };

  // Save textual overlays
  const handleCreateTextNote = () => {
    if (!textInputPending || !textInputValue.trim()) {
      setTextInputPending(null);
      return;
    }

    const noteId = 'note_' + Math.random().toString(36).substr(2, 9);
    const newNote: TextNote = {
      id: noteId,
      text: textInputValue.trim(),
      x: textInputPending.x,
      y: textInputPending.y,
      color: color
    };

    setTextNotes([...textNotes, newNote]);
    setTextInputPending(null);
    setTextInputValue('');
    setRedoTextHistory([]);
  };

  // Native undo vector engine
  const handleUndo = () => {
    if (activeTool === 'text' && textNotes.length > 0) {
      const remaining = [...textNotes];
      const undone = remaining.pop();
      if (undone) {
        setTextNotes(remaining);
        setRedoTextHistory([...redoTextHistory, undone]);
      }
    } else if (strokes.length > 0) {
      const remaining = [...strokes];
      const undone = remaining.pop();
      if (undone) {
        setStrokes(remaining);
        setRedoHistory([...redoHistory, undone]);
      }
    }
  };

  // Native redo vector engine
  const handleRedo = () => {
    if (activeTool === 'text' && redoTextHistory.length > 0) {
      const remainingHistory = [...redoTextHistory];
      const redone = remainingHistory.pop();
      if (redone) {
        setTextNotes([...textNotes, redone]);
        setRedoTextHistory(remainingHistory);
      }
    } else if (redoHistory.length > 0) {
      const remainingHistory = [...redoHistory];
      const redone = remainingHistory.pop();
      if (redone) {
        setStrokes([...strokes, redone]);
        setRedoHistory(remainingHistory);
      }
    }
  };

  // Complete wipe
  const handleWipeCanvas = () => {
    if (confirm("Deseja realmente limpar todos os desenhos deste planejamento facial?")) {
      setStrokes([]);
      setRedoHistory([]);
      setTextNotes([]);
      setRedoTextHistory([]);
    }
  };

  // Trigger callback sending planning payload inside database structures
  const handleCommitSave = () => {
    const serialized = JSON.stringify({
      strokes,
      textNotes
    });

    // Create an asset bundle data overlay of the annotation layer
    let base64Overlay: string | undefined;
    if (canvasRef.current) {
      try {
        base64Overlay = canvasRef.current.toDataURL('image/png');
      } catch (e) {
        console.warn("Base64 layer extraction failed (possible cross-origin image constraints):", e);
      }
    }

    onSavePlanning(serialized, base64Overlay);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-6 w-full flex flex-col items-center justify-between gap-6 overflow-hidden">
      
      {/* Upper toolbar controls */}
      <header className="w-full flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4 select-none shrink-0 text-left">
        <div className="space-y-0.5">
          <h4 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 bg-rose-500 rounded-full animate-ping"></span>
            Editor de Planejamento Facial Ativo
          </h4>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
            Adequado para Caneta Digital, Touchscreens de Alta Precisão e Mouse
          </p>
        </div>

        {/* Core vector actions */}
        <div className="flex flex-wrap items-center gap-2">
          
          <button 
            type="button"
            onClick={handleUndo}
            disabled={strokes.length === 0 && textNotes.length === 0}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 rounded-xl transition-all cursor-pointer"
            title="Desfazer"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          
          <button 
            type="button"
            onClick={handleRedo}
            disabled={redoHistory.length === 0 && redoTextHistory.length === 0}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 rounded-xl transition-all cursor-pointer"
            title="Refazer"
          >
            <Redo2 className="w-4 h-4" />
          </button>

          <button 
            type="button"
            onClick={() => setIsDrawingVisibilityActive(!isDrawingVisibilityActive)}
            className={`p-2.5 rounded-xl transition-all flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest cursor-pointer ${
              isDrawingVisibilityActive ? 'bg-slate-800 text-teal-400' : 'bg-slate-950 text-slate-500 border border-slate-800'
            }`}
            title="Toggle Visibilidade das Camadas"
          >
            {isDrawingVisibilityActive ? (
              <>
                <Eye className="w-4 h-4" /> Exibindo Desenhos
              </>
            ) : (
              <>
                <EyeOff className="w-4 h-4" /> Desenhos Ocultos
              </>
            )}
          </button>

          <button 
            type="button"
            onMouseDown={() => setIsComparingWithOriginal(true)}
            onMouseUp={() => setIsComparingWithOriginal(false)}
            onTouchStart={() => setIsComparingWithOriginal(true)}
            onTouchEnd={() => setIsComparingWithOriginal(false)}
            className="p-2 px-3.5 bg-rose-950/40 hover:bg-rose-900/40 border border-rose-900/40 text-rose-350 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer"
            title="Segure para ocultar desenhos temporariamente e comparar"
          >
            Comparar com Original
          </button>

          <button 
            type="button"
            onClick={handleWipeCanvas}
            className="p-2.5 bg-rose-950 text-rose-450 border border-rose-900/30 hover:bg-rose-900 hover:text-rose-200 rounded-xl transition-all cursor-pointer"
            title="Limpar Tudo"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          {onClose && (
            <button 
              type="button"
              onClick={onClose}
              className="p-2.5 bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800 rounded-xl cursor-pointer"
              title="Fechar Editor"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
          )}

        </div>
      </header>

      {/* Main Sandbox Interactive Workspace */}
      <div className="w-full flex-grow flex flex-col lg:flex-row gap-6 relative justify-center items-stretch min-h-[450px]">
        
        {/* Left side: Paintbox Tools selector */}
        <div className="w-full lg:w-48 bg-slate-950 border border-slate-850 p-4 rounded-2xl flex flex-col gap-4 text-left select-none shrink-0">
          
          <div>
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-2">Ferramenta Ativa</span>
            <div className="grid grid-cols-3 lg:grid-cols-2 gap-1.5">
              {[
                { id: 'pen', label: 'Pincel', icon: PenTool },
                { id: 'line', label: 'Linha', icon: Move },
                { id: 'arrow', label: 'Seta', icon: ArrowUpRight },
                { id: 'circle', label: 'Círculo', icon: Circle },
                { id: 'text', label: 'Texto', icon: Type },
                { id: 'eraser', label: 'Borracha', icon: Eraser },
              ].map(t => {
                const IsActive = activeTool === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setActiveTool(t.id as any);
                      setTextInputPending(null);
                    }}
                    className={`py-3 px-1 rounded-xl transition-all flex flex-col items-center justify-center gap-1.5 cursor-pointer ${
                      IsActive 
                        ? 'bg-teal-655 text-white shadow-md shadow-teal-700/20' 
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <t.icon className="w-4 h-4 shrink-0" />
                    <span className="text-[8px] font-black uppercase tracking-widest">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-2">Espessura do Traço</span>
            <div className="flex gap-2">
              {[2, 3, 5, 8].map(w => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setLineWidth(w)}
                  className={`flex-1 py-1.5 text-[9px] font-black text-slate-300 rounded border cursor-pointer transition-all ${
                    lineWidth === w ? 'bg-slate-800 border-teal-500' : 'bg-slate-900 border-slate-800'
                  }`}
                >
                  {w}px
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Paleta de Marcador</span>
            <div className="grid grid-cols-6 gap-2">
              {colorPalette.map(c => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  className={`w-full aspect-square rounded-lg border-2 relative cursor-pointer ${
                    color === c.value ? 'border-teal-400 scale-105' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c.value }}
                  title={c.name}
                >
                  {color === c.value && (
                    <span className="absolute inset-0 m-auto w-1 h-1 bg-slate-950 rounded-full"></span>
                  )}
                </button>
              ))}
            </div>
          </div>

        </div>

        {/* Center: Image viewport framing canvas overlays */}
        <div 
          ref={containerRef}
          className="flex-1 bg-slate-950/80 rounded-2xl border border-slate-850 flex items-center justify-center relative overflow-hidden p-2"
        >
          <div className="relative inline-block overflow-hidden max-w-full max-h-[65vh]">
            {/* Clinical baseline image */}
            <img 
              ref={imageRef}
              src={imageUrl} 
              alt="Caso Clínico para Planejamento" 
              onLoad={handleImageLoad}
              referrerPolicy="no-referrer"
              className="object-contain block max-w-full max-h-[65vh] rounded-xl pointer-events-none"
            />

            {/* SVG drawing sandbox layout overlay */}
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className={`absolute inset-0 w-full h-full cursor-crosshair z-10 select-none ${
                isComparingWithOriginal ? 'opacity-0' : 'opacity-100'
              }`}
              style={{ touchAction: 'none' }} // Stops default page scrolls on touch screens
            />

            {/* Input prompt bubble portal for Text markup node */}
            {textInputPending && (
              <div 
                className="absolute z-20 flex flex-col gap-1.5 p-3 bg-slate-950 border border-slate-800 rounded-xl shadow-2xl max-w-[200px]"
                style={{ 
                  left: `${textInputPending.x * 100}%`, 
                  top: `${textInputPending.y * 100}%`,
                  transform: 'translate(-50%, -100%)' 
                }}
              >
                <input 
                  type="text" 
                  value={textInputValue}
                  onChange={(e) => setTextInputValue(e.target.value)}
                  placeholder="Escrever notas..."
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateTextNote();
                    if (e.key === 'Escape') setTextInputPending(null);
                  }}
                  className="w-full px-2 py-1.5 bg-slate-900 text-white rounded border border-slate-850 text-xs font-semibold outline-none"
                />
                <div className="flex gap-1">
                  <button 
                    onClick={handleCreateTextNote}
                    className="flex-1 px-2 py-1 bg-teal-605 hover:bg-teal-700 text-white rounded text-[8.5px] font-black uppercase tracking-wider cursor-pointer"
                  >
                    Confirmar
                  </button>
                  <button 
                    onClick={() => setTextInputPending(null)}
                    className="px-2 py-1 bg-slate-800 text-slate-400 rounded text-[8.5px] font-black uppercase tracking-wider cursor-pointer"
                  >
                    Sair
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Footer controls submit */}
      <footer className="w-full flex justify-end gap-3 border-t border-slate-800 pt-4 shrink-0">
        <button
          type="button"
          onClick={handleCommitSave}
          className="px-6 py-3 bg-teal-605 hover:bg-teal-700 text-white font-black uppercase tracking-widest text-xs rounded-xl shadow-lg transition-all flex items-center gap-2 cursor-pointer"
        >
          <Check className="w-4 h-4" /> Salvar Planejamento Clínico
        </button>
      </footer>

    </div>
  );
}
