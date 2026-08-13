import React, { useState, useEffect } from 'react';
import { 
  PenTool, 
  Trash2, 
  UploadCloud, 
  Sparkles, 
  Smile, 
  Layers, 
  HelpCircle, 
  RefreshCw, 
  Eye, 
  FileText, 
  Plus, 
  Minimize,
  CheckCircle,
  Scissors
} from 'lucide-react';
import InteractivePlanningCanvas from './InteractivePlanningCanvas';

// Pre-seeded high-quality illustrative/sketch placeholder face profile URLs
const CLINICAL_TEMPLATES = {
  frontal: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=800&q=80',
  profileRight: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80',
  smile: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=800&q=80',
  intraoral: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=800&q=80'
};

const DEFAULT_DEMO_PATIENTS = [
  {
    id: 'demo_paciente_1',
    name: '[DEMO] Ana Paula Santos',
    age: '34 anos',
    notes: 'Demonstração de Sulco Nasogeniano Proeminente e Perda de Volume Malar (Instrução HOF)',
    images: {
      frontal: CLINICAL_TEMPLATES.frontal,
      profileRight: CLINICAL_TEMPLATES.profileRight,
      smile: CLINICAL_TEMPLATES.smile,
      intraoral: CLINICAL_TEMPLATES.intraoral
    },
    drawings: {} as Record<string, string>,
    overlays: {} as Record<string, string>
  },
  {
    id: 'demo_paciente_2',
    name: '[DEMO] Carlos Eduardo Oliveira',
    age: '42 anos',
    notes: 'Análise Profilométrica de Ricketts e Projeção de Mento para Harmonização Linha Mandibular',
    images: {
      frontal: CLINICAL_TEMPLATES.profileRight, // using another portrait for variety
      profileRight: CLINICAL_TEMPLATES.profileRight,
      smile: CLINICAL_TEMPLATES.smile,
      intraoral: CLINICAL_TEMPLATES.intraoral
    },
    drawings: {} as Record<string, string>,
    overlays: {} as Record<string, string>
  }
];

interface ProfessorPlanningDemoProps {
  onLogAction?: (category: string, detail: string) => void;
}

export default function ProfessorPlanningDemo({ onLogAction }: ProfessorPlanningDemoProps) {
  const [patientsList, setPatientsList] = useState<any[]>(() => {
    const saved = localStorage.getItem('elisa_demo_patients');
    return saved ? JSON.parse(saved) : DEFAULT_DEMO_PATIENTS;
  });

  const [activePatientId, setActivePatientId] = useState<string>(DEFAULT_DEMO_PATIENTS[0].id);
  const [activePlanningImage, setActivePlanningImage] = useState<{ category: string; url: string; item: any } | null>(null);
  
  // Custom customizer fields
  const [showGridOverlay, setShowGridOverlay] = useState<boolean>(true);
  const [selectedGridType, setSelectedGridType] = useState<'thirds' | 'profile' | 'symmetry'>('thirds');
  const [newPatientName, setNewPatientName] = useState<string>('');
  const [newPatientNotes, setNewPatientNotes] = useState<string>('');

  // Save current sandbox back to localStorage when changed
  useEffect(() => {
    localStorage.setItem('elisa_demo_patients', JSON.stringify(patientsList));
  }, [patientsList]);

  const activePatient = patientsList.find(p => p.id === activePatientId) || patientsList[0];

  const handleSaveDemoDrawing = (category: string, drawingsJson: string, base64Overlay: string) => {
    setPatientsList(prev => prev.map(p => {
      if (p.id === activePatientId) {
        const updatedDrawings = { ...(p.drawings || {}), [category]: drawingsJson };
        const updatedOverlays = { ...(p.overlays || {}), [category]: base64Overlay };
        return { ...p, drawings: updatedDrawings, overlays: updatedOverlays };
      }
      return p;
    }));

    if (onLogAction) {
      onLogAction('[PROF_DEMO_PLAN]', `Atualizou marcação de planejamento (${category}) em paciente de demonstração: ${activePatient.name}`);
    }
  };

  const clearDrawings = (category: string) => {
    if (!window.confirm('Deseja realmente limpar as marcações desta imagem?')) return;
    setPatientsList(prev => prev.map(p => {
      if (p.id === activePatientId) {
        const updatedDrawings = { ...(p.drawings || {}) };
        const updatedOverlays = { ...(p.overlays || {}) };
        delete updatedDrawings[category];
        delete updatedOverlays[category];
        return { ...p, drawings: updatedDrawings, overlays: updatedOverlays };
      }
      return p;
    }));
  };

  const handleCustomImageUpload = (category: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64Url = reader.result as string;
      setPatientsList(prev => prev.map(p => {
        if (p.id === activePatientId) {
          const updatedImages = { ...(p.images || {}), [category]: base64Url };
          return { ...p, images: updatedImages };
        }
        return p;
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleCreateDemoPatient = () => {
    if (!newPatientName.trim()) return;
    const newId = `demo_paciente_${Date.now()}`;
    const newObj = {
      id: newId,
      name: `[DEMO] ${newPatientName}`,
      age: 'Idade Indefinida',
      notes: newPatientNotes || 'Paciente para aula prática de diagnóstico',
      images: {
        frontal: CLINICAL_TEMPLATES.frontal,
        profileRight: CLINICAL_TEMPLATES.profileRight,
        smile: CLINICAL_TEMPLATES.smile,
        intraoral: CLINICAL_TEMPLATES.intraoral
      },
      drawings: {},
      overlays: {}
    };

    setPatientsList(prev => [...prev, newObj]);
    setActivePatientId(newId);
    setNewPatientName('');
    setNewPatientNotes('');
  };

  const handleDeleteDemoPatient = (pId: string) => {
    if (patientsList.length <= 1) {
      alert('É necessário ter ao menos um paciente de demonstração ativo.');
      return;
    }
    if (!window.confirm('Tem certeza que deseja excluir este paciente de demonstração?')) return;
    const remaining = patientsList.filter(p => p.id !== pId);
    setPatientsList(remaining);
    setActivePatientId(remaining[0].id);
  };

  const handleResetAllDemo = () => {
    if (!window.confirm('Deseja redefinir todos os pacientes de demonstração aos padrões de fábrica? Suas marcações atuais serão apagadas.')) return;
    localStorage.removeItem('elisa_demo_patients');
    setPatientsList(DEFAULT_DEMO_PATIENTS);
    setActivePatientId(DEFAULT_DEMO_PATIENTS[0].id);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-left border-b border-slate-100 pb-4">
        <div>
          <span className="p-1 px-2.5 bg-indigo-50 border border-indigo-150 text-indigo-700 rounded-md font-bold text-[8.5px] uppercase tracking-wider inline-block">
            Painel do Professor - Demonstração Prática
          </span>
          <h2 className="text-lg font-black text-slate-900 tracking-tight uppercase mt-1">Ambiente de Planejamento de Paciente</h2>
          <p className="text-[10.5px] text-slate-500 font-bold leading-normal mt-0.5">
            Dê aulas interativas utilizando marcações ao vivo na tela sobre fotos de pacientes reais ou esboços estéticos faciais.
          </p>
        </div>

        <button 
          onClick={handleResetAllDemo}
          className="p-2 bg-slate-100 text-slate-600 hover:bg-slate-200 text-xs font-bold uppercase rounded-xl flex items-center gap-1.5 transition-all self-start"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Redefinir Sandbox
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 text-left">
        
        {/* Sidebar: Patient selector and quick simulation tools */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white p-5 rounded-3xl border border-slate-200 space-y-4">
            <h3 className="text-[10px] font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-indigo-600" /> Pacientes Disponíveis
            </h3>

            <div className="space-y-2">
              {patientsList.map(p => {
                const isActive = p.id === activePatientId;
                return (
                  <div 
                    key={p.id} 
                    className={`p-3 rounded-2xl border text-left cursor-pointer transition-all relative group ${
                      isActive 
                        ? 'border-indigo-600 bg-indigo-50/20' 
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                    onClick={() => setActivePatientId(p.id)}
                  >
                    <h4 className="text-[11px] font-black text-slate-900 truncate leading-none">{p.name}</h4>
                    <p className="text-[9.5px] text-slate-500 font-semibold truncate mt-1.5">{p.notes}</p>
                    {isActive && (
                      <span className="absolute top-2 right-2 w-2 h-2 bg-indigo-600 rounded-full" />
                    )}
                    {patientsList.length > 1 && !isActive && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteDemoPatient(p.id);
                        }}
                        className="absolute bottom-2 right-2 p-1 text-slate-400 hover:text-red-600 bg-transparent opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick Creator */}
          <div className="bg-white p-5 rounded-3xl border border-slate-200 space-y-3.5">
            <h3 className="text-[10px] font-black text-slate-800 uppercase tracking-wider">Criar Novo Paciente Demo</h3>
            <div className="space-y-2">
              <input
                type="text"
                value={newPatientName}
                onChange={(e) => setNewPatientName(e.target.value)}
                placeholder="Nome do Alvo Aula"
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[10.5px] font-bold text-slate-700 outline-none font-sans"
              />
              <textarea
                value={newPatientNotes}
                onChange={(e) => setNewPatientNotes(e.target.value)}
                placeholder="Observações clínicas de instrução..."
                className="w-full h-16 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[10.5px] font-medium text-slate-700 outline-none font-sans resize-none"
              />
              <button
                onClick={handleCreateDemoPatient}
                className="w-full py-2.5 bg-indigo-650 hover:bg-indigo-700 text-white rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 mt-2 shadow-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Adicionar Paciente
              </button>
            </div>
          </div>

          {/* Guide explanations for orofacial overlays */}
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-150 text-[10px] text-slate-500 font-bold space-y-2">
            <h4 className="font-black text-slate-700 uppercase tracking-tight flex items-center gap-1">
              <HelpCircle className="w-3.5 h-3.5" /> Como usar nas aulas:
            </h4>
            <p className="leading-relaxed">
              1. Selecione um paciente de demonstração acima.
              <br />
              2. Caso queira, faça upload de fotos reais do seu paciente nas caixas de imagem ao lado.
              <br />
              3. Clique no ícone de lápis para abrir a tela cheia de desenhos e explicar linhas estéticas aos alunos.
              <br />
              4. A grade auxilia a explicar proporções áureas de simetria vertical e perfil.
            </p>
          </div>

        </div>

        {/* Central visual grid showing customizable photos to plan */}
        <div className="lg:col-span-3 space-y-5">
          <div className="bg-white p-6 rounded-[2rem] border border-slate-200 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-3">
              <div className="space-y-1">
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">
                  Ficha de Diagnóstico Fotográfico: <span className="text-indigo-600">{activePatient.name}</span>
                </h3>
                <p className="text-[10px] text-slate-450 font-bold uppercase">{activePatient.notes}</p>
              </div>

              {/* Dynamic Overlay Config selector */}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500 cursor-pointer">
                  <input 
                    type="checkbox"
                    checked={showGridOverlay}
                    onChange={(e) => setShowGridOverlay(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-600 cursor-pointer"
                  />
                  Eixos de Auxílio
                </label>
                
                {showGridOverlay && (
                  <select
                    value={selectedGridType}
                    onChange={(e) => setSelectedGridType(e.target.value as any)}
                    className="p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[9px] font-black text-slate-700 outline-none uppercase tracking-wide cursor-pointer"
                  >
                    <option value="thirds">Terços Horizontais (Faciais)</option>
                    <option value="profile">Perfil de Rickett (E-Line)</option>
                    <option value="symmetry">Linhas de Simetria Lateral</option>
                  </select>
                )}
              </div>
            </div>

            {/* Pictures grid - 4 positions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-2">
              {['frontal', 'profileRight', 'smile', 'intraoral'].map(category => {
                const imageUrl = activePatient.images?.[category] || CLINICAL_TEMPLATES.frontal;
                const drawings = activePatient.drawings?.[category];
                const overlay = activePatient.overlays?.[category];
                
                const labelMap: Record<string, string> = {
                  frontal: 'Foto Frontal Repouso',
                  profileRight: 'Foto de Perfil Direito',
                  smile: 'Foto Frontal Sorriso',
                  intraoral: 'Foto Intraoral Estética'
                };

                return (
                  <div key={category} className="group relative bg-slate-950 rounded-[2rem] overflow-hidden border border-slate-200 flex flex-col h-[320px] shadow-sm select-none">
                    
                    {/* Background image & drawings overlays loaded */}
                    <div className="relative flex-1 overflow-hidden">
                      <img 
                        src={imageUrl} 
                        alt={labelMap[category]} 
                        className="w-full h-full object-cover select-none"
                        referrerPolicy="no-referrer"
                      />

                      {/* Displaying existing drawings base64 overlay if present */}
                      {overlay && (
                        <div className="absolute inset-0 z-1 pointer-events-none">
                          <img 
                            src={overlay} 
                            alt="Drawing overlay" 
                            className="w-full h-full object-cover" 
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      )}

                      {/* Diagnostic dynamic grid lines overlay */}
                      {showGridOverlay && (
                        <div className="absolute inset-0 pointer-events-none z-2 flex flex-col justify-between p-4">
                          {selectedGridType === 'thirds' && (
                            <div className="w-full h-full flex flex-col justify-between border-y-2 border-dashed border-red-500/40 relative">
                              <div className="absolute top-[33.3%] left-0 w-full border-t-2 border-dashed border-red-500/40" />
                              <div className="absolute top-[66.6%] left-0 w-full border-t-2 border-dashed border-red-500/40" />
                              <span className="absolute top-2 left-2 bg-red-600 text-white text-[7.5px] font-black uppercase p-0.5 px-1 rounded">1/3 Sup</span>
                              <span className="absolute top-[38%] left-2 bg-red-600 text-white text-[7.5px] font-black uppercase p-0.5 px-1 rounded">1/3 Med</span>
                              <span className="absolute top-[71%] left-2 bg-red-600 text-white text-[7.5px] font-black uppercase p-0.5 px-1 rounded">1/3 Inf</span>
                            </div>
                          )}

                          {selectedGridType === 'profile' && (
                            <div className="w-full h-full relative">
                              {/* Slanted E-line from tip of nose towards chin center */}
                              <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
                                <line 
                                  x1="65%" y1="20%" x2="52%" y2="85%" 
                                  stroke="#3b82f6" strokeWidth="2.5" strokeDasharray="5,5" 
                                />
                                <text x="56%" y="95%" fill="#3b82f6" fontSize="9" fontWeight="black">LINHA-E RICKETTS</text>
                              </svg>
                            </div>
                          )}

                          {selectedGridType === 'symmetry' && (
                            <div className="w-full h-full relative flex items-center justify-center">
                              <div className="h-full border-l-2 border-dashed border-amber-500/50 absolute left-1/2" />
                              <div className="w-full border-t-2 border-dashed border-amber-500/50 absolute top-1/2" />
                              <span className="absolute top-2 left-2 bg-amber-600 text-white text-[7.5px] font-black uppercase p-0.5 px-1 rounded">Eixo Simetria</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Bottom labels bar */}
                      <div className="absolute bottom-4 left-4 right-4 bg-slate-900/95 border border-slate-800 p-2.5 rounded-xl z-3 flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-wider text-white">
                          {labelMap[category]}
                        </span>
                        
                        <div className="flex gap-2">
                          {drawings && (
                            <button 
                              onClick={() => clearDrawings(category)}
                              className="text-red-400 hover:text-red-600 border-none bg-transparent p-1 shadow-sm font-sans"
                              title="Limpar marcações"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          
                          <button
                            onClick={() => setActivePlanningImage({ category, url: imageUrl, item: activePatient })}
                            className="bg-indigo-650 text-white hover:bg-indigo-700 p-1.5 px-2.5 rounded-lg text-[9px] font-black uppercase tracking-widest border-none flex items-center gap-1 cursor-pointer"
                          >
                            <PenTool className="w-3.5 h-3.5" /> Estudo/Traço
                          </button>
                        </div>
                      </div>

                      {/* Custom image uploader triggered on cover hover */}
                      <label className="absolute top-4 right-4 bg-slate-900/80 hover:bg-indigo-600 text-white p-2 rounded-xl border border-slate-700 pointer transition-all cursor-pointer inline-flex">
                        <UploadCloud className="w-4 h-4" />
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleCustomImageUpload(category, e)}
                        />
                      </label>
                    </div>

                  </div>
                );
              })}
            </div>

            <div className="bg-amber-50 border border-amber-250 p-4 rounded-2xl text-[10.5px] text-slate-700 font-medium">
              💡 <span className="font-bold">Dica de Lousa Digital:</span> Ao abrir o estudo interativo ("Estudo/Traço"), você ganha pincéis sob medida para marcar pontos de injeção de toxina botulínica, desenhar limites de preenchimento facial, delimitar área de lipo de papada mecânica ou instruir sobre posicionamentos de fios de sustentação PDO (Polidioxanona).
            </div>
          </div>
        </div>

      </div>

      {/* Embedded interactive canvas overlay */}
      {activePlanningImage && (
        <div className="fixed inset-0 bg-slate-950/95 z-[110] flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-5xl">
            <InteractivePlanningCanvas 
              imageUrl={activePlanningImage.url}
              initialDrawingsJson={activePlanningImage.item.drawings?.[activePlanningImage.category]}
              onSavePlanning={(drawingsJson, base64Overlay) => {
                handleSaveDemoDrawing(activePlanningImage.category, drawingsJson, base64Overlay);
                setActivePlanningImage(null);
              }}
              onClose={() => setActivePlanningImage(null)}
            />
          </div>
        </div>
      )}

    </div>
  );
}
