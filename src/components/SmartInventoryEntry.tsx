import React, { useState, useRef } from "react";
import { 
  Upload, 
  Camera, 
  FileText, 
  Sparkles, 
  AlertCircle, 
  CheckCircle2, 
  Trash2, 
  Edit2, 
  Check, 
  RefreshCw, 
  Plus, 
  Search,
  ChevronDown,
  X,
  PlusCircle,
  AlertTriangle,
  Package,
  ArrowRight,
  Info
} from "lucide-react";
import { doc, setDoc, addDoc, collection, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../contexts/AuthContext";
import { InventoryAIService, ExtractedInventoryDoc, ExtractedItem } from "../services/inventoryAIService";
import { motion } from "motion/react";

interface SmartInventoryEntryProps {
  existingItems: any[];
  onSuccess: () => void;
  onCancel: () => void;
}

// Sample invoice for easy testing when a user evaluates the features
const SAMPLE_INVOICE_BASE64 = `iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=`;

export default function SmartInventoryEntry({ existingItems, onSuccess, onCancel }: SmartInventoryEntryProps) {
  const { clinic, user } = useAuth();
  
  // States
  const [step, setStep] = useState<"upload" | "processing" | "review" | "success">("upload");
  const [source, setSource] = useState<"invoice" | "quote" | "purchase_list">("invoice");
  const [fileData, setFileData] = useState<{ url: string; type: string; name: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<ExtractedInventoryDoc | null>(null);
  const [loadingMsg, setLoadingMsg] = useState("Iniciando processamento...");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Edit states for review
  const [supplierName, setSupplierName] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [totalAmount, setTotalAmount] = useState(0);
  const [reviewItems, setReviewItems] = useState<ExtractedItem[]>([]);
  
  // State to track expanded item on mobile
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Handle Drag Over
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  // Process selected file
  const processFile = async (file: File) => {
    if (!clinic || !user) return;
    setStep("processing");
    setErrorMsg(null);
    setLoadingMsg("Carregando arquivo e gerando upload temporário...");

    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Url = e.target?.result as string;
      setFileData({
        url: base64Url,
        type: file.type,
        name: file.name
      });

      console.log("[INVENTORY_AI] upload started:", file.name, "type:", file.type);
      
      try {
        // Save temporary item in Firestore for tracking and durability
        const uploadRef = doc(collection(db, "clinics", clinic.id, "inventory_uploads"));
        const uploadId = uploadRef.id;

        const uploadData = {
          fileUrl: base64Url.substring(0, 1000 * 1000), // Protect size in firestore, base64 data saved
          fileType: file.type,
          status: "processing",
          createdBy: user.uid,
          createdAt: serverTimestamp(),
          source: source
        };

        await setDoc(uploadRef, uploadData);
        console.log("[INVENTORY_AI] document metadata saved to database:", uploadId);

        setLoadingMsg("A ELIZA está lendo e decodificando o documento com inteligência artificial...");
        
        // Trigger Gemini analysis
        const extracted = await InventoryAIService.analyzeInventoryDocument({
          clinicId: clinic.id,
          uploadId: uploadId,
          fileUrl: base64Url,
          fileType: file.type,
          source: source
        });

        console.log("[INVENTORY_AI] extracted items:", extracted.items);
        const matchesData = extracted.items.filter(i => i.matchStatus === "Encontrado no estoque" || i.matchStatus === "Possível correspondência");
        console.log("[INVENTORY_AI] matched products:", matchesData);

        // Map outcomes
        setSupplierName(extracted.supplierName || "");
        setDocumentDate(extracted.documentDate || new Date().toISOString().split("T")[0]);
        setInvoiceNumber(extracted.invoiceNumber || "");
        setTotalAmount(extracted.totalAmount || 0);
        setReviewItems(extracted.items || []);
        
        // Update database with extracted logs
        await updateDoc(uploadRef, {
          status: "reviewed",
          extractedRawText: JSON.stringify(extracted),
          aiConfidence: extracted.items?.reduce((acc, curr) => acc + (curr.confidence || 1.0), 0) / (extracted.items?.length || 1)
        });

        setStep("review");
      } catch (err: any) {
        console.error("[INVENTORY_AI] error during pipeline execution:", err);
        setErrorMsg(err.message || "Não foi possível extrair os dados. Por favor, tente enviar outra imagem mais nítida ou insira manualmente.");
        setStep("upload");
      }
    };

    reader.readAsDataURL(file);
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  // Simulates loading a clean template representation for testing/demonstration
  const handleLoadSample = async () => {
    if (!clinic || !user) return;
    setStep("processing");
    setErrorMsg(null);
    setLoadingMsg("Carregando pre-set de nota fiscal odontológica para demonstração...");

    setTimeout(async () => {
      try {
        const sampleUrl = `data:image/png;base64,${SAMPLE_INVOICE_BASE64}`;
        setFileData({
          url: sampleUrl,
          type: "image/png",
          name: "nota_fiscal_dental_exemplo.png"
        });

        const uploadRef = doc(collection(db, "clinics", clinic.id, "inventory_uploads"));
        const uploadId = uploadRef.id;

        await setDoc(uploadRef, {
          fileUrl: sampleUrl,
          fileType: "image/png",
          status: "processing",
          createdBy: user.uid,
          createdAt: serverTimestamp(),
          source: "invoice"
        });

        setLoadingMsg("ELIZA AI interpretando itens: resinas, anestésicos, luvas descartáveis...");

        const sampleResult: ExtractedInventoryDoc = {
          supplierName: "Dental Cremer Produtos Odontológicos Ltda",
          documentDate: new Date().toISOString().split("T")[0],
          invoiceNumber: "NF-93821",
          totalAmount: 489.90,
          items: [
            {
              rawName: "RESINA CHARISMA DIAMOND A2 SPECTRUM 4G",
              suggestedName: "Resina Charisma Diamond A2 - Heraeus Kulzer",
              quantity: 3,
              unit: "unid",
              unitPrice: 110.00,
              totalPrice: 330.00,
              batch: "LT-83726A",
              expirationDate: "2028-10-15",
              category: "Consumíveis",
              confidence: 0.98,
              matchedProductId: existingItems.find(i => i.name.toLowerCase().includes("resina"))?.id || "",
              matchStatus: existingItems.some(i => i.name.toLowerCase().includes("resina")) ? "Possível correspondência" : "Novo item"
            },
            {
              rawName: "LUVAS PROCEDIMENTO LATEX C/ PO TALGE M",
              suggestedName: "Luvas de Procedimento Látex (M) - Talge",
              quantity: 5,
              unit: "cx",
              unitPrice: 31.98,
              totalPrice: 159.90,
              batch: "LV-2026M",
              expirationDate: "2027-04-20",
              category: "Descartáveis",
              confidence: 0.94,
              matchedProductId: existingItems.find(i => i.name.toLowerCase().includes("luva") || i.name.toLowerCase().includes("lápis"))?.id || "",
              matchStatus: existingItems.some(i => i.name.toLowerCase().includes("luva")) ? "Encontrado no estoque" : "Novo item"
            }
          ]
        };

        setSupplierName(sampleResult.supplierName);
        setDocumentDate(sampleResult.documentDate);
        setInvoiceNumber(sampleResult.invoiceNumber);
        setTotalAmount(sampleResult.totalAmount);
        setReviewItems(sampleResult.items);

        await updateDoc(uploadRef, {
          status: "reviewed",
          extractedRawText: JSON.stringify(sampleResult)
        });

        setStep("review");
      } catch (err: any) {
        setErrorMsg(err.message || "Erro ao carregar simulação.");
        setStep("upload");
      }
    }, 1500);
  };

  // Launch direct manual insertion flow
  const handleManualInsert = () => {
    setSupplierName("");
    setDocumentDate(new Date().toISOString().split("T")[0]);
    setInvoiceNumber("");
    setTotalAmount(0);
    setReviewItems([
      {
        rawName: "Novo Material",
        suggestedName: "Novo Material",
        quantity: 1,
        unit: "unid",
        unitPrice: 0,
        totalPrice: 0,
        batch: "",
        expirationDate: "",
        category: "Consumíveis",
        confidence: 1.0,
        matchedProductId: "",
        matchStatus: "Novo item"
      }
    ]);
    setStep("review");
  };

  // Update a single field on parsed item during review
  const handleUpdateItemField = (index: number, field: keyof ExtractedItem, value: any) => {
    const updated = [...reviewItems];
    updated[index] = {
      ...updated[index],
      [field]: value
    };

    // Auto calculate product total price when qty or unit price changes
    if (field === "quantity" || field === "unitPrice") {
      updated[index].totalPrice = Number((Number(updated[index].quantity) * Number(updated[index].unitPrice)).toFixed(2));
    }

    // Auto adjust matchStatus representation if user manually links a Product ID
    if (field === "matchedProductId") {
      const pId = value as string;
      if (pId === "") {
        updated[index].matchStatus = "Novo item";
      } else {
        updated[index].matchStatus = "Encontrado no estoque";
        // Optionally bind suggestedName to actual matching product's current name
        const matchItem = existingItems.find(i => i.id === pId);
        if (matchItem) {
          updated[index].suggestedName = matchItem.name;
          updated[index].category = matchItem.category;
          updated[index].unit = matchItem.unit;
        }
      }
    }

    setReviewItems(updated);

    // Auto compute totalAmount of whole document sum
    const totalSum = updated.reduce((acc, item) => acc + (item.matchStatus === "Novo item" || item.matchStatus === "Encontrado no estoque" || item.matchStatus === "Possível correspondência" ? (item.totalPrice || 0) : 0), 0);
    setTotalAmount(Number(totalSum.toFixed(2)));
  };

  // Remove single row from review
  const handleRemoveReviewItem = (index: number) => {
    const updated = reviewItems.filter((_, i) => i !== index);
    setReviewItems(updated);
    const totalSum = updated.reduce((acc, item) => acc + (item.totalPrice || 0), 0);
    setTotalAmount(Number(totalSum.toFixed(2)));
  };

  // Add editable manual row
  const handleAddReviewRow = () => {
    setReviewItems([
      ...reviewItems,
      {
        rawName: "Novo Item Adicionado",
        suggestedName: "Novo Item Adicionado",
        quantity: 1,
        unit: "unid",
        unitPrice: 0.0,
        totalPrice: 0.0,
        batch: "",
        expirationDate: "",
        category: "Consumíveis",
        confidence: 1.0,
        matchedProductId: "",
        matchStatus: "Novo item"
      }
    ]);
  };

  // CONFIRM STOCK ENTRY AND SAVE SYSTEM WIDE
  const handleConfirmStockEntry = async () => {
    if (!clinic || !user) return;
    setStep("processing");
    setLoadingMsg("Registrando e atualizando estoque da clínica...");

    console.log("[INVENTORY_AI] confirm stock entry: starting entry updates for", reviewItems.length, "items");

    // Filter items to process
    const itemsToProcess = reviewItems.filter(item => item.matchStatus !== "Novo item" || item.suggestedName.trim() !== "");
    console.log("[INVENTORY_AI] confirm stock entry:", itemsToProcess);

    try {
      const { doc: fsDoc, updateDoc: fsUpdateDoc } = await import("firebase/firestore");

      for (const item of itemsToProcess) {
        let finalItemId = item.matchedProductId;
        let prevQty = 0;
        let newQty = item.quantity;

        if (item.matchedProductId) {
          // A. UPDATE EXISTING STOCK ITEM
          const existing = existingItems.find(i => i.id === item.matchedProductId);
          if (existing) {
            prevQty = Number(existing.stock) || 0;
            newQty = prevQty + Number(item.quantity);

            console.log(`[INVENTORY_AI] updating existing item: ${existing.name} (id: ${existing.id}), pre: ${prevQty}, added: ${item.quantity}, new: ${newQty}`);

            // Update item details
            const itemRef = fsDoc(db, "clinics", clinic.id, "inventory", existing.id);
            await fsUpdateDoc(itemRef, {
              stock: newQty,
              expiry: item.expirationDate || existing.expiry || "",
              updatedAt: serverTimestamp()
            });
          }
        } else {
          // B. CREATE NEW STOCK ITEM IN 'inventory'
          console.log(`[INVENTORY_AI] creating new inventory item: ${item.suggestedName}`);
          const newDocRef = await addDoc(collection(db, "clinics", clinic.id, "inventory"), {
            name: item.suggestedName,
            category: item.category || "Consumíveis",
            stock: Number(item.quantity),
            minStock: Number(item.quantity) > 5 ? 5 : 2, // helper baseline
            unit: item.unit || "unid",
            expiry: item.expirationDate || "",
            createdAt: serverTimestamp()
          });
          finalItemId = newDocRef.id;
        }

        // C. WRITE MOVEMENT AUDIT LOG
        const movementLog = {
          itemId: finalItemId,
          type: "entrada",
          quantity: Number(item.quantity),
          unit: item.unit || "unid",
          previousQuantity: prevQty,
          newQuantity: newQty,
          unitPrice: Number(item.unitPrice),
          totalPrice: Number(item.totalPrice),
          supplierName: supplierName || "Não Informado",
          sourceDocumentId: invoiceNumber || "Não Informado",
          createdBy: user.uid,
          createdAt: serverTimestamp(),
          notes: `Entrada Inteligente via ELIZA AI | Documento: Lote: ${item.batch || "N/A"}`
        };

        console.log("[INVENTORY_AI] writing stock movement:", movementLog);
        await addDoc(collection(db, "clinics", clinic.id, "inventory_movements"), movementLog);
      }

      setStep("success");
    } catch (err: any) {
      console.error("[INVENTORY_AI] error saving stock counts:", err);
      setErrorMsg(`Erro de gravação: ${err.message}. Por favor, verifique sua rede.`);
      setStep("review");
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 w-full max-w-full box-border overflow-x-hidden">
      
      {/* HEADER BAR */}
      <div className="flex items-center justify-between mb-6 border-b border-slate-200 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-teal-50 rounded-xl text-teal-600">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
              Entrada Inteligente
              <span className="text-[10px] font-black bg-teal-600/10 text-teal-700 px-2 py-0.5 rounded-full uppercase tracking-wider">ELIZA Core v1</span>
            </h3>
            <p className="text-xs text-slate-500 font-medium">Extração de notas fiscais e conciliação de suprimentos com IA.</p>
          </div>
        </div>
        <button 
          onClick={onCancel}
          className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {errorMsg && (
        <div className="mb-6 p-4 bg-rose-50 border border-rose-100 rounded-xl text-rose-700 flex items-start gap-3 text-xs font-semibold">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* STEP 1: UPLOAD ZONE */}
      {step === "upload" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Main Upload Box */}
          <div className="lg:col-span-2">
            <div className="mb-4 flex items-center gap-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Origem do Arquivo</label>
              <div className="flex bg-slate-100 p-0.5 rounded-lg ml-auto">
                <button 
                  onClick={() => setSource("invoice")}
                  className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${source === "invoice" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                >
                  Nota Fiscal
                </button>
                <button 
                  onClick={() => setSource("quote")}
                  className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${source === "quote" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                >
                  Orçamento
                </button>
                <button 
                  onClick={() => setSource("purchase_list")}
                  className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${source === "purchase_list" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                >
                  Lista de Compras
                </button>
              </div>
            </div>

            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleFileDrop}
              className={`border-2 border-dashed rounded-[2rem] p-10 text-center flex flex-col items-center justify-center min-h-[300px] transition-all relative overflow-hidden bg-white ${isDragging ? "border-teal-600 bg-teal-50/20 scale-[0.99]" : "border-slate-200 hover:border-slate-300"}`}
            >
              <div className="w-16 h-16 bg-teal-50 text-teal-600 rounded-full flex items-center justify-center mb-4 border border-teal-100">
                <Upload className="w-8 h-8 animate-pulse" />
              </div>

              <h4 className="text-sm font-bold text-slate-800 mb-1">Arraste seu documento ou imagem aqui</h4>
              <p className="text-xs text-slate-400 mb-6 max-w-sm">
                Envie fotos em JPG/PNG, arquivos PDF de notas fiscais, cupons, faturas ou folhas físicas do seu celular.
              </p>

              <div className="flex flex-col sm:flex-row gap-3">
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-teal-600 text-white px-5 py-2.5 rounded-xl font-bold text-xs shadow-md shadow-teal-600/20 hover:bg-teal-700 transition-colors flex items-center justify-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  Enviar arquivo / Foto
                </button>
                <button 
                  onClick={() => cameraInputRef.current?.click()}
                  className="bg-slate-100 text-slate-700 hover:bg-slate-200 px-5 py-2.5 rounded-xl font-bold text-xs transition-colors flex items-center justify-center gap-2"
                >
                  <Camera className="w-4 h-4" />
                  Tirar foto agora
                </button>
              </div>

              {/* Hidden file selectors */}
              <input 
                ref={fileInputRef} 
                type="file" 
                accept="image/*,application/pdf" 
                className="hidden" 
                onChange={handleFileChange} 
              />
              <input 
                ref={cameraInputRef} 
                type="file" 
                accept="image/*" 
                capture="environment" 
                className="hidden" 
                onChange={handleFileChange} 
              />
            </div>
          </div>

          {/* Quick Sandbox Tools */}
          <div className="bg-slate-900 text-white rounded-[2rem] p-6 flex flex-col justify-between shadow-xl">
            <div>
              <div className="flex items-center gap-2 text-teal-400 text-xs font-bold uppercase tracking-wider mb-4">
                <Sparkles className="w-4 h-4" />
                Destaques da IA
              </div>
              <h4 className="text-base font-bold text-white mb-2 leading-snug">Avalie o Reconhecimento Inteligente agora mesmo</h4>
              <p className="text-slate-400 text-xs leading-relaxed mb-6">
                Não possui uma nota fiscal ou foto no computador agora? Sem problemas! Nós criamos um preset realista para você testar todos os recursos da ELIZA em segundos.
              </p>

              <ul className="space-y-3.5 mb-8">
                <li className="flex gap-2.5 items-start text-xs text-slate-300">
                  <CheckCircle2 className="w-4 h-4 text-teal-400 mt-0.5 shrink-0" />
                  <span>Reconhecimento de itens, quantidades e valores em fotos complexas.</span>
                </li>
                <li className="flex gap-2.5 items-start text-xs text-slate-300">
                  <CheckCircle2 className="w-4 h-4 text-teal-400 mt-0.5 shrink-0" />
                  <span>Pontuação de similaridade e match automático no estoque existente.</span>
                </li>
                <li className="flex gap-2.5 items-start text-xs text-slate-300">
                  <CheckCircle2 className="w-4 h-4 text-teal-400 mt-0.5 shrink-0" />
                  <span>Reconciliação visual fluida com aprovação em 1 clique.</span>
                </li>
              </ul>
            </div>

            <div className="space-y-2">
              <button 
                onClick={handleLoadSample}
                className="w-full bg-teal-600 hover:bg-teal-700 text-white py-3 rounded-xl font-bold text-xs transition-colors flex items-center justify-center gap-2 shadow-lg shadow-teal-600/20"
              >
                <Sparkles className="w-4 h-4" />
                Simular Nota de Exemplo
              </button>
              <button 
                onClick={handleManualInsert}
                className="w-full bg-white/10 hover:bg-white/20 text-slate-300 py-3 rounded-xl font-bold text-xs transition-colors"
              >
                Inserir Itens Manualmente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: PROCESSING STATE */}
      {step === "processing" && (
        <div className="py-16 text-center max-w-md mx-auto flex flex-col items-center">
          <div className="relative mb-6">
            <div className="w-20 h-20 border-4 border-teal-600/20 border-t-teal-600 rounded-full animate-spin flex items-center justify-center"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-teal-500 animate-pulse" />
            </div>
          </div>
          <h4 className="text-base font-bold text-slate-800 mb-2">Processamento de Inteligência...</h4>
          <p className="text-xs text-slate-500 leading-relaxed font-semibold">{loadingMsg}</p>
          <div className="mt-8 p-3 bg-slate-100 rounded-xl text-[10px] font-mono text-slate-500 uppercase tracking-widest text-center w-full">
            STATUS: ACTIVE // EXTRACTING_METADATA_PIPELINE
          </div>
        </div>
      )}

      {/* STEP 3: REVIEW SYSTEM */}
      {step === "review" && (
        <div className="space-y-6">
          
          {/* Top Banner Alert Info */}
          <div className="p-4 bg-teal-50 border border-teal-100 rounded-2xl flex items-start gap-3 text-teal-800">
            <Info className="w-5 h-5 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wide">Revisão Necessária</p>
              <p className="text-xs opacity-90 font-medium">
                A ELIZA reconheceu os itens automaticamente. Revise ou adicione dados abaixo antes de confirmar a entrada oficial no estoque da clínica.
              </p>
            </div>
          </div>

          {/* Header Metadata Container */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Dados Básicos do Lançamento</h4>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Fornecedor / Emitente</label>
                <input 
                  type="text" 
                  value={supplierName} 
                  onChange={(e) => setSupplierName(e.target.value)} 
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-teal-600 focus:bg-white transition-colors"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Número do Doc / Nota Fiscal</label>
                <input 
                  type="text" 
                  placeholder="Ex: NF-10928"
                  value={invoiceNumber} 
                  onChange={(e) => setInvoiceNumber(e.target.value)} 
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-teal-600 focus:bg-white transition-colors"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Data de Emissão</label>
                <input 
                  type="date" 
                  value={documentDate} 
                  onChange={(e) => setDocumentDate(e.target.value)} 
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-teal-600 focus:bg-white transition-colors"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Valor Total Apurado (R$)</label>
                <div className="px-4 py-2 bg-slate-100 border border-slate-200 rounded-xl text-xs font-extrabold text-slate-800">
                  R$ {totalAmount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          </div>

          {/* TABLE VIEW (DESKTOP) */}
          <div className="hidden md:block bg-white border border-slate-200 rounded-[2rem] overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-6">Nome Lido (IA) / Estoque Vinculado</th>
                    <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center w-20">Qtd</th>
                    <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center w-24">Unidade</th>
                    <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right w-28">Vl Unit (R$)</th>
                    <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right w-28">Total (R$)</th>
                    <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center w-32">Lote / Validade</th>
                    <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center w-20">Excluir</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reviewItems.map((item, index) => {
                    return (
                      <tr key={index} className="hover:bg-slate-50/50 transition-colors">
                        {/* Name and mapping */}
                        <td className="p-4 pl-6 space-y-2">
                          <input 
                            type="text" 
                            value={item.suggestedName} 
                            onChange={(e) => handleUpdateItemField(index, "suggestedName", e.target.value)} 
                            className="bg-transparent border-0 border-b border-transparent hover:border-slate-300 focus:border-teal-600 outline-none w-full font-bold text-slate-800 text-xs py-0.5"
                          />
                          
                          {/* Stock Matching Selector Dropdown */}
                          <div className="flex items-center gap-2">
                            <span className={`text-[8px] font-bold tracking-wider px-2 py-0.5 rounded-full uppercase shrink-0 ${
                              item.matchStatus === "Encontrado no estoque" ? "bg-emerald-50 text-emerald-700 border border-emerald-100" :
                              item.matchStatus === "Possível correspondência" ? "bg-amber-50 text-amber-700 border border-amber-100" :
                              "bg-sky-50 text-sky-700 border border-sky-100"
                            }`}>
                              {item.matchStatus}
                            </span>
                            
                            <select
                              value={item.matchedProductId || ""}
                              onChange={(e) => handleUpdateItemField(index, "matchedProductId", e.target.value)}
                              className="text-[10px] font-bold text-slate-500 bg-slate-100/60 hover:bg-slate-100 border-0 rounded-lg px-2 py-0.5 max-w-[200px] font-sans truncate outline-none cursor-pointer"
                            >
                              <option value="">-- Criar como Novo Item --</option>
                              {existingItems.map(p => (
                                <option key={p.id} value={p.id}>{p.name} ({p.stock} {p.unit})</option>
                              ))}
                            </select>
                          </div>
                        </td>

                        {/* Quantity */}
                        <td className="p-4 text-center">
                          <input 
                            type="number" 
                            value={item.quantity} 
                            onChange={(e) => handleUpdateItemField(index, "quantity", Number(e.target.value))} 
                            className="w-16 px-2 py-1 bg-slate-100 border-0 rounded-lg text-center font-bold text-xs shrink-0 outline-none text-slate-800"
                          />
                        </td>

                        {/* Unit */}
                        <td className="p-4 text-center">
                          <input 
                            type="text" 
                            value={item.unit} 
                            onChange={(e) => handleUpdateItemField(index, "unit", e.target.value)} 
                            className="w-16 px-2 py-1 bg-slate-100 border-0 rounded-lg text-center font-semibold text-xs shrink-0 outline-none text-slate-800"
                          />
                        </td>

                        {/* Unit Price */}
                        <td className="p-4 text-right">
                          <div className="flex items-center gap-1 justify-end">
                            <span className="text-[10px] text-slate-400 font-bold">R$</span>
                            <input 
                              type="number" 
                              step="0.01"
                              value={item.unitPrice} 
                              onChange={(e) => handleUpdateItemField(index, "unitPrice", Number(e.target.value))} 
                              className="w-20 px-2 py-1 bg-slate-100 border-0 rounded-lg text-right font-bold text-xs outline-none text-slate-800"
                            />
                          </div>
                        </td>

                        {/* Total Price */}
                        <td className="p-4 text-right font-extrabold text-xs text-slate-700">
                          R$ {item.totalPrice.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </td>

                        {/* Batch & Expiration */}
                        <td className="p-4 space-y-1">
                          <input 
                            type="text" 
                            placeholder="Lote"
                            value={item.batch} 
                            onChange={(e) => handleUpdateItemField(index, "batch", e.target.value)} 
                            className="w-full px-2 py-1 bg-slate-100 border-0 rounded-lg text-center font-semibold text-[10px] outline-none text-slate-800"
                          />
                          <input 
                            type="date" 
                            value={item.expirationDate} 
                            onChange={(e) => handleUpdateItemField(index, "expirationDate", e.target.value)} 
                            className="w-full px-2 py-1 bg-slate-100 border-0 rounded-lg text-center font-semibold text-[10px] outline-none text-slate-800"
                          />
                        </td>

                        {/* Delete */}
                        <td className="p-4 text-center">
                          <button 
                            onClick={() => handleRemoveReviewItem(index)}
                            className="p-1.5 hover:bg-rose-50 rounded-lg text-slate-300 hover:text-rose-600 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  
                  {reviewItems.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-12 text-center text-slate-400 italic">Nenhum item adicionado à lista.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* CARDS LIST FOR MOBILE DEVICES */}
          <div className="block md:hidden space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Materiais ({reviewItems.length})</span>
              <button 
                onClick={handleAddReviewRow}
                className="text-[10px] font-bold text-teal-600 uppercase flex items-center gap-1.5"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                Adicionar outro
              </button>
            </div>
            
            {reviewItems.map((item, index) => {
              const matchesExist = existingItems.length > 0;
              const isExpanded = expandedIndex === index;
              return (
                <div 
                  key={index} 
                  className={`border rounded-2xl p-4 bg-white shadow-sm transition-all ${
                    isExpanded ? "border-teal-500 ring-2 ring-teal-500/10" : "border-slate-200"
                  }`}
                >
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <input 
                        type="text" 
                        value={item.suggestedName} 
                        onChange={(e) => handleUpdateItemField(index, "suggestedName", e.target.value)} 
                        className="font-bold text-slate-800 text-xs w-full bg-slate-50 border-none rounded-lg px-2 py-1 outline-none focus:bg-white"
                      />
                      <div className="mt-2 flex flex-wrap gap-1.5 items-center">
                        <span className={`text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                          item.matchStatus === "Encontrado no estoque" ? "bg-emerald-50 text-emerald-700 border-emerald-100" :
                          item.matchStatus === "Possível correspondência" ? "bg-amber-50 text-amber-700 border-amber-100" :
                          "bg-sky-50 text-sky-700 border-sky-100"
                        }`}>
                          {item.matchStatus}
                        </span>
                        
                        <select
                          value={item.matchedProductId || ""}
                          onChange={(e) => handleUpdateItemField(index, "matchedProductId", e.target.value)}
                          className="text-[9px] font-bold text-slate-500 bg-slate-100 rounded-md px-1.5 py-0.5 outline-none truncate max-w-[150px]"
                        >
                          <option value="">-- Criar Novo --</option>
                          {existingItems.map(p => (
                            <option key={p.id} value={p.id}>{p.name} ({p.stock} {p.unit})</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <button 
                      onClick={() => handleRemoveReviewItem(index)}
                      className="p-1.5 hover:bg-rose-50 text-slate-300 hover:text-rose-600 rounded-lg shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Quantity and Price fast-grid */}
                  <div className="mt-4 grid grid-cols-4 gap-2 border-t border-slate-100 pt-3">
                    <div className="col-span-1">
                      <p className="text-[7px] font-bold text-slate-400 uppercase tracking-widest mb-1 text-center">Qtd</p>
                      <input 
                        type="number" 
                        value={item.quantity} 
                        onChange={(e) => handleUpdateItemField(index, "quantity", Number(e.target.value))} 
                        className="w-full text-center py-1 bg-slate-100 border-none rounded-lg font-bold text-xs"
                      />
                    </div>
                    <div className="col-span-1">
                      <p className="text-[7px] font-bold text-slate-400 uppercase tracking-widest mb-1 text-center">Unid</p>
                      <input 
                        type="text" 
                        value={item.unit} 
                        onChange={(e) => handleUpdateItemField(index, "unit", e.target.value)} 
                        className="w-full text-center py-1 bg-slate-100 border-none rounded-lg font-semibold text-xs"
                      />
                    </div>
                    <div className="col-span-1">
                      <p className="text-[7px] font-bold text-slate-400 uppercase tracking-widest mb-1 text-right">R$ Unit</p>
                      <input 
                        type="number" 
                        value={item.unitPrice} 
                        onChange={(e) => handleUpdateItemField(index, "unitPrice", Number(e.target.value))} 
                        className="w-full text-right py-1 bg-slate-100 border-none rounded-lg font-extrabold text-xs"
                      />
                    </div>
                    <div className="col-span-1 flex flex-col justify-end text-right">
                      <p className="text-[7px] font-bold text-slate-400 uppercase tracking-widest mb-1">R$ Total</p>
                      <span className="font-extrabold text-[11px] text-slate-700 py-1">
                        {item.totalPrice.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>

                  {/* Expand button details */}
                  <div className="mt-3 flex gap-2 justify-between">
                    <button 
                      onClick={() => setExpandedIndex(isExpanded ? null : index)}
                      className="text-[9px] font-black uppercase text-slate-400 hover:text-slate-600 flex items-center gap-1"
                    >
                      {isExpanded ? "Fechar detalhes" : "Ver Lote / Validade"}
                      <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    </button>
                  </div>

                  {/* Expanded block values */}
                  {isExpanded && (
                    <div className="mt-3 border-t border-dashed border-slate-200 pt-3 grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Código Lote</label>
                        <input 
                          type="text" 
                          placeholder="LT-XXXXX"
                          value={item.batch} 
                          onChange={(e) => handleUpdateItemField(index, "batch", e.target.value)} 
                          className="w-full text-xs py-1 bg-slate-50 border-none rounded-lg px-2"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Data Validade</label>
                        <input 
                          type="date" 
                          value={item.expirationDate} 
                          onChange={(e) => handleUpdateItemField(index, "expirationDate", e.target.value)} 
                          className="w-full text-xs py-1 bg-slate-50 border-none rounded-lg px-2"
                        />
                      </div>
                    </div>
                  )}

                </div>
              );
            })}
          </div>

          {/* Actions Bottom Bar */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4 justify-between border-t border-slate-200">
            <button 
              onClick={handleAddReviewRow}
              className="hidden md:flex bg-slate-100 hover:bg-slate-200 text-slate-700 px-5 py-3 rounded-2xl font-bold text-xs items-center gap-2 mr-auto"
            >
              <Plus className="w-4 h-4" />
              Adicionar Novo Material
            </button>
            <div className="grid grid-cols-2 sm:flex gap-3 w-full sm:w-auto">
              <button 
                onClick={() => setStep("upload")}
                className="col-span-1 px-5 py-3.5 border border-slate-200 hover:bg-slate-50 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-400"
              >
                Refazer Envio
              </button>
              <button 
                onClick={handleConfirmStockEntry}
                disabled={reviewItems.length === 0}
                className="col-span-1 px-5 py-3.5 bg-teal-600 hover:bg-teal-700 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-teal-600/20 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" />
                Confirmar Entrada
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 4: SUCCESS */}
      {step === "success" && (
        <div className="py-16 text-center max-w-sm mx-auto flex flex-col items-center">
          <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mb-6 border border-emerald-100">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h4 className="text-lg font-bold text-slate-900 mb-2">Entrada Registrada!</h4>
          <p className="text-xs text-slate-500 leading-relaxed mb-8 font-medium">
            Os itens e quantidades foram somados às listagens correspondentes e as movimentações de histórico foram criadas com êxito na ELIZA.
          </p>
          <div className="space-y-3 w-full">
            <button 
              onClick={onSuccess}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white py-3 rounded-xl font-bold text-xs transition-colors"
            >
              Voltar ao Estoque
            </button>
            <button 
              onClick={() => {
                setFileData(null);
                setReviewItems([]);
                setStep("upload");
              }}
              className="w-full bg-teal-600/10 hover:bg-teal-600/20 text-teal-700 py-3 rounded-xl font-bold text-xs transition-colors"
            >
              Lançar Outra Nota / Arquivo
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
