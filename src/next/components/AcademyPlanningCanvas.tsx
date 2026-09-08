import React, { useRef, useState, useEffect } from 'react';
import {
  Undo2, Redo2, Trash2, Type, Circle, ArrowUpRight, PenTool, Eraser, Check, Eye, EyeOff, Move, Minimize2,
  Target, Hexagon, ZoomIn, ZoomOut, Maximize2, Hand,
} from 'lucide-react';

interface Point { x: number; y: number; }

interface Stroke {
  id: string;
  type: 'pen' | 'line' | 'arrow' | 'circle' | 'eraser' | 'point' | 'area';
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
  /** Subset of tool ids to show, in order. Omit to show all 9 (unchanged default for Academy). */
  enabledTools?: string[];
  /**
   * Clinical Learning Workspace (2026-08-29): fires whenever the set of
   * `point`-type strokes changes (create/delete), so a side panel (the
   * ficha's point table) can stay mirrored in real time — not just read back
   * after a save. `order` is 1-based creation order, matching the numbered
   * badge drawn next to each marker on canvas.
   */
  onPointsChange?: (points: { id: string; x: number; y: number; order: number }[]) => void;
  /** Controlled highlight: set from outside (e.g. hovering/clicking a ficha
   * table row) to ring-highlight the matching marker on canvas. */
  selectedPointId?: string | null;
  /** Fires when an EXISTING point marker is clicked (selects it — does not
   * create a new point). The panel outside uses this for "click the point on
   * the map highlights its row". Pass null to clear selection (e.g. clicking
   * empty canvas). */
  onSelectPoint?: (id: string | null) => void;
  /** External delete command: set to a point's id to remove that marker
   * (e.g. the ficha table row's own delete button) without requiring the
   * user to also click the canvas's own trash icon. Any change to a
   * non-null value is treated as a fresh request, even the same id twice. */
  deleteRequestedPointId?: string | null;
  /** Browsing an already-frozen submission (e.g. the professor viewing the
   * student's own layer): no drawing, no delete, no save — clicking an
   * existing point still selects it (for the ficha table highlight), it just
   * can never create/move/remove a marker. Zoom/undo history are still
   * visible-only; the toolbar hides every action that would mutate strokes. */
  readOnly?: boolean;
  /**
   * Cor-por-dose (2026-08-30): quando presente, cada marcador tipo 'point' é
   * pintado com o retorno desta função (chamada a cada render, não gravada
   * no stroke) em vez de `stroke.color` — assim a cor acompanha sozinha
   * quando a dose do ponto muda na ficha, sem precisar recriar o marcador.
   * Também esconde a paleta de cor manual e o controle de Espessura: não faz
   * sentido escolher cor livre com a dose já ditando a cor do ponto.
   */
  pointColorFor?: (pointId: string) => string;
}

const ALL_TOOLS = [
  { id: 'pen', label: 'Pincel', icon: PenTool },
  { id: 'point', label: 'Ponto', icon: Target },
  { id: 'line', label: 'Linha', icon: Move },
  { id: 'arrow', label: 'Seta', icon: ArrowUpRight },
  { id: 'circle', label: 'Círculo', icon: Circle },
  { id: 'area', label: 'Área', icon: Hexagon },
  { id: 'text', label: 'Texto', icon: Type },
  { id: 'eraser', label: 'Borracha', icon: Eraser },
  { id: 'move', label: 'Mover', icon: Hand },
];

// Reusable drawing/annotation canvas — used both by the professor (drawing the
// "gabarito" over an approved student case) and by the student (annotating
// their own approved case), and by Planejamento IA (marking clinical
// planning notes over a patient photo). Ported from the legacy education
// module's InteractivePlanningCanvas; drawing logic kept as-is (it's
// solid), visual language adapted to the Next dark/purple design system.
// point/area/zoom were added for Planejamento IA — additive only, the
// original pen/line/arrow/circle/text/eraser toolset used by Academy is
// untouched.
export default function AcademyPlanningCanvas({
  imageUrl, onSavePlanning, initialDrawingsJson, onClose, enabledTools,
  onPointsChange, selectedPointId, onSelectPoint, deleteRequestedPointId, readOnly,
  pointColorFor,
}: AcademyPlanningCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const tools = enabledTools && enabledTools.length > 0 ? ALL_TOOLS.filter(t => enabledTools.includes(t.id)) : ALL_TOOLS;

  const [activeTool, setActiveTool] = useState<'pen' | 'line' | 'arrow' | 'circle' | 'text' | 'eraser' | 'point' | 'area' | 'move'>((tools[0]?.id as any) || 'pen');
  const [color, setColor] = useState<string>('#f43f5e');
  const [lineWidth, setLineWidth] = useState<number>(3);
  const [isDrawingVisibilityActive, setIsDrawingVisibilityActive] = useState<boolean>(true);
  const [isComparingWithOriginal, setIsComparingWithOriginal] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(1);
  // 'move' pans the container via pointer deltas (not native touch scroll —
  // the canvas keeps touchAction:none so drawing gestures stay precise on
  // tablets/stylus, so panning has to be done through the same pointer
  // events instead of relying on the browser's own touch-scroll).
  const panRef = useRef<{ x: number; y: number } | null>(null);

  // Lazily parsed on the FIRST render (not via a mount effect) so `strokes`
  // is already correct before the very first `onPointsChange` firing — a
  // mount effect would leave `strokes` at its `[]` initial value for one
  // extra render, firing `onPointsChange([])` before the real points ever
  // reach the parent. A parent panel that rebuilds its point-record map
  // from that array (e.g. ClinicalFichaPanel's point table) would then wipe
  // out real, already-persisted records it just loaded — confirmed as a
  // real data-loss bug testing the real-patient Execução workspace
  // (2026-08-29): Firestore had the correct pointRecords, but reopening the
  // execution rendered them empty because of exactly this race.
  const parseInitialDrawings = (json?: string): { strokes: Stroke[]; textNotes: TextNote[] } => {
    if (!json) return { strokes: [], textNotes: [] };
    try {
      const parsed = JSON.parse(json);
      return { strokes: parsed.strokes || [], textNotes: parsed.textNotes || [] };
    } catch (e) {
      console.error('Failed to parse initial planning drawings data:', e);
      return { strokes: [], textNotes: [] };
    }
  };
  const [strokes, setStrokes] = useState<Stroke[]>(() => parseInitialDrawings(initialDrawingsJson).strokes);
  const [redoHistory, setRedoHistory] = useState<Stroke[]>([]);
  const [textNotes, setTextNotes] = useState<TextNote[]>(() => parseInitialDrawings(initialDrawingsJson).textNotes);
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
      } else if (stroke.type === 'point') {
        const pt = stroke.points[0];
        ctx.fillStyle = pointColorFor ? pointColorFor(stroke.id) : stroke.color;
        ctx.beginPath();
        ctx.arc(pt.x * w, pt.y * h, Math.max(4, stroke.width * 1.5), 0, 2 * Math.PI);
        ctx.fill();
      } else if (stroke.type === 'area') {
        // Freeform closed region — like 'pen' but closed back to the start
        // and filled at low alpha, for marking a facial zone/area rather
        // than a precise line.
        for (let i = 1; i < stroke.points.length; i++) {
          const pt = stroke.points[i];
          ctx.lineTo(pt.x * w, pt.y * h);
        }
        ctx.closePath();
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = stroke.color;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.stroke();
      }
    };

    strokes.forEach(renderStroke);
    if (currentStroke) renderStroke(currentStroke);
    ctx.globalCompositeOperation = 'source-over';

    // Numbered badge (creation order) + selection ring for each point marker
    // — the visual half of "Ponto 01 ↔ registro da ficha ↔ clicar destaca".
    let pointOrder = 0;
    strokes.forEach((stroke) => {
      if (stroke.type !== 'point' || stroke.points.length === 0) return;
      pointOrder += 1;
      const pt = stroke.points[0];
      const cx = pt.x * w, cy = pt.y * h;
      const radius = Math.max(4, stroke.width * 1.5);
      if (stroke.id === selectedPointId) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 5, 0, 2 * Math.PI);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.beginPath();
      ctx.arc(cx + radius + 7, cy - radius - 7, 9, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(pointOrder), cx + radius + 7, cy - radius - 6);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    });

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
  }, [strokes, currentStroke, textNotes, isDrawingVisibilityActive, isComparingWithOriginal, dimensions, selectedPointId, pointColorFor]);

  // Mirrors the point-type strokes out to a parent panel (the ficha's point
  // table) in real time — every create/delete, not just on save. `order` is
  // creation order (1-based), the same number drawn as a badge on canvas.
  useEffect(() => {
    if (!onPointsChange) return;
    const points = strokes
      .filter(s => s.type === 'point')
      .map((s, i) => ({ id: s.id, x: s.points[0]?.x ?? 0, y: s.points[0]?.y ?? 0, order: i + 1 }));
    onPointsChange(points);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes]);

  // External delete command (e.g. the ficha table row's own delete button) —
  // same effect as selecting the point then clicking the canvas's own trash
  // icon, just reachable from outside without that extra step.
  useEffect(() => {
    if (!deleteRequestedPointId) return;
    setStrokes((prev) => prev.filter((s) => s.id !== deleteRequestedPointId));
    if (selectedPointId === deleteRequestedPointId) onSelectPoint?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteRequestedPointId]);

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
    if (activeTool === 'move') {
      panRef.current = { x: e.clientX, y: e.clientY };
      return;
    }
    const pt = getNormalizedPoint(e);
    // Read-only (e.g. professor browsing the student's frozen layer): the
    // only allowed interaction is selecting an EXISTING point, for the
    // linked ficha table to highlight — never create/move a marker.
    if (readOnly) {
      const hitRadiusNorm = 14 / Math.min(dimensions.width || 1, dimensions.height || 1);
      const hit = [...strokes].reverse().find((s) => {
        if (s.type !== 'point' || s.points.length === 0) return false;
        const dx = s.points[0].x - pt.x, dy = s.points[0].y - pt.y;
        return Math.sqrt(dx * dx + dy * dy) <= hitRadiusNorm;
      });
      onSelectPoint?.(hit ? hit.id : null);
      return;
    }
    if (activeTool === 'text') {
      setTextInputPending({ x: pt.x, y: pt.y });
      setTextInputValue('');
      return;
    }
    const strokeId = 'stroke_' + Math.random().toString(36).substr(2, 9);
    if (activeTool === 'point') {
      // Clicking ON an existing marker selects it (for the linked ficha
      // table to highlight) instead of stacking a new point on top of it.
      // Hit radius is normalized against the shorter canvas dimension so it
      // stays a consistent physical click target regardless of image shape.
      const hitRadiusNorm = 14 / Math.min(dimensions.width || 1, dimensions.height || 1);
      const hit = [...strokes].reverse().find((s) => {
        if (s.type !== 'point' || s.points.length === 0) return false;
        const dx = s.points[0].x - pt.x, dy = s.points[0].y - pt.y;
        return Math.sqrt(dx * dx + dy * dy) <= hitRadiusNorm;
      });
      if (hit) {
        onSelectPoint?.(hit.id);
        return;
      }
      // No drag needed — a single click/tap places a new marker immediately.
      setStrokes((prev) => [...prev, { id: strokeId, type: 'point', color, width: lineWidth, points: [pt] }]);
      setRedoHistory([]);
      onSelectPoint?.(null);
      return;
    }
    const newStroke: Stroke = { id: strokeId, type: activeTool === 'eraser' ? 'eraser' : (activeTool as any), color, width: lineWidth, points: [pt] };
    setCurrentStroke(newStroke);
    setRedoHistory([]);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (readOnly) return;
    if (panRef.current) {
      const dx = e.clientX - panRef.current.x;
      const dy = e.clientY - panRef.current.y;
      panRef.current = { x: e.clientX, y: e.clientY };
      containerRef.current?.scrollBy({ left: -dx, top: -dy });
      return;
    }
    if (!currentStroke) return;
    const pt = getNormalizedPoint(e);
    let updatedPoints = [...currentStroke.points];
    if (currentStroke.type === 'pen' || currentStroke.type === 'eraser' || currentStroke.type === 'area') {
      updatedPoints.push(pt);
    } else {
      if (updatedPoints.length > 1) updatedPoints[1] = pt;
      else updatedPoints.push(pt);
    }
    setCurrentStroke({ ...currentStroke, points: updatedPoints });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (panRef.current) { panRef.current = null; return; }
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
    // A selected point deletes just that marker (matches the ficha table's
    // own "excluir" row action, which sets selectedPointId then triggers
    // this) — never the whole canvas, which would silently wipe unrelated
    // freehand annotations the user never asked to remove.
    if (selectedPointId) {
      setStrokes((prev) => prev.filter((s) => s.id !== selectedPointId));
      onSelectPoint?.(null);
      return;
    }
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
            <span className={`w-2.5 h-2.5 rounded-full ${readOnly ? 'bg-slate-600' : 'bg-next-purple-neon animate-ping'}`} />
            {readOnly ? 'Visualização — somente leitura' : 'Editor de Planejamento Ativo'}
          </h4>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{readOnly ? 'Clique num ponto pra destacar o registro' : 'Caneta digital, touchscreen ou mouse'}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && (
            <button type="button" onClick={handleUndo} disabled={strokes.length === 0 && textNotes.length === 0} className="p-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 rounded-xl transition-all" title="Desfazer">
              <Undo2 className="w-4 h-4" />
            </button>
          )}
          {!readOnly && (
            <button type="button" onClick={handleRedo} disabled={redoHistory.length === 0 && redoTextHistory.length === 0} className="p-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 rounded-xl transition-all" title="Refazer">
              <Redo2 className="w-4 h-4" />
            </button>
          )}
          <button type="button" onClick={() => setIsDrawingVisibilityActive(v => !v)} className={`p-2.5 rounded-xl transition-all flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest ${isDrawingVisibilityActive ? 'bg-slate-800 text-next-purple-light' : 'bg-slate-950 text-slate-500 border border-next-border'}`}>
            {isDrawingVisibilityActive ? (<><Eye className="w-4 h-4" /> Exibindo</>) : (<><EyeOff className="w-4 h-4" /> Ocultos</>)}
          </button>
          {!readOnly && (
            <button type="button" onMouseDown={() => setIsComparingWithOriginal(true)} onMouseUp={() => setIsComparingWithOriginal(false)} onTouchStart={() => setIsComparingWithOriginal(true)} onTouchEnd={() => setIsComparingWithOriginal(false)} className="p-2 px-3.5 bg-next-red-alert/10 hover:bg-next-red-alert/20 border border-next-red-alert/20 text-next-red-alert rounded-xl text-[10px] font-black uppercase tracking-widest transition-all" title="Segure para comparar com o original">
              Comparar com Original
            </button>
          )}
          {!readOnly && (
            <button type="button" onClick={handleWipeCanvas} className="p-2.5 bg-next-red-alert/10 text-next-red-alert border border-next-red-alert/20 hover:bg-next-red-alert/20 rounded-xl transition-all" title={selectedPointId ? 'Excluir ponto selecionado' : 'Limpar Tudo'}>
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {onClose && (
            <button type="button" onClick={onClose} className="p-2.5 bg-slate-950 text-slate-400 hover:text-slate-200 border border-next-border rounded-xl" title="Fechar Editor">
              <Minimize2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      <div className="w-full flex-grow flex flex-col lg:flex-row gap-6 relative justify-center items-stretch min-h-[450px]">
        <div className="w-full lg:w-48 bg-slate-950 border border-next-border p-4 rounded-2xl flex flex-col gap-4 text-left select-none shrink-0">
          {!readOnly && (
          <div>
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-2">Ferramenta Ativa</span>
            <div className="grid grid-cols-3 lg:grid-cols-2 gap-1.5">
              {tools.map(t => {
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
          )}

          {!readOnly && !pointColorFor && (
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
          )}

          {!readOnly && !pointColorFor && (
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
          )}

          <div>
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-2">Zoom / Mover</span>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setZoom((z) => Math.max(1, +(z - 0.25).toFixed(2)))} disabled={zoom <= 1} className="flex-1 py-1.5 bg-slate-900 border border-next-border text-slate-300 rounded disabled:opacity-40" title="Reduzir zoom">
                <ZoomOut className="w-3.5 h-3.5 mx-auto" />
              </button>
              <button type="button" onClick={() => setZoom(1)} disabled={zoom === 1} className="flex-1 py-1.5 bg-slate-900 border border-next-border text-slate-300 rounded disabled:opacity-40" title="Restaurar zoom">
                <Maximize2 className="w-3.5 h-3.5 mx-auto" />
              </button>
              <button type="button" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} disabled={zoom >= 3} className="flex-1 py-1.5 bg-slate-900 border border-next-border text-slate-300 rounded disabled:opacity-40" title="Aumentar zoom">
                <ZoomIn className="w-3.5 h-3.5 mx-auto" />
              </button>
            </div>
            {zoom > 1 && <p className="text-[9px] text-slate-600 mt-1.5">{Math.round(zoom * 100)}% — use a ferramenta "Mover" para arrastar a imagem</p>}
          </div>
        </div>

        <div ref={containerRef} className="flex-1 bg-slate-950/80 rounded-2xl border border-next-border flex items-center justify-center relative overflow-auto p-2">
          <div className="relative inline-block max-w-full max-h-[65vh]" style={{ transform: `scale(${zoom})`, transformOrigin: 'center center', transition: 'transform 0.15s ease' }}>
            <img ref={imageRef} src={imageUrl} alt="Caso clínico" onLoad={handleImageLoad} referrerPolicy="no-referrer" className="object-contain block max-w-full max-h-[65vh] rounded-xl pointer-events-none" />
            <canvas ref={canvasRef} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} className={`absolute inset-0 w-full h-full select-none ${isComparingWithOriginal ? 'opacity-0' : 'opacity-100'} ${readOnly ? 'cursor-pointer' : activeTool === 'move' ? 'cursor-move' : 'cursor-crosshair'}`} style={{ touchAction: 'none' }} />
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

      {!readOnly && (
        <footer className="w-full flex justify-end gap-3 border-t border-next-border pt-4 shrink-0">
          <button type="button" onClick={handleCommitSave} className="px-6 py-3 next-brand-gradient-bg text-white font-black uppercase tracking-widest text-xs rounded-xl shadow-next-glow-purple transition-all flex items-center gap-2">
            <Check className="w-4 h-4" /> Salvar Planejamento
          </button>
        </footer>
      )}
    </div>
  );
}
