# ELIZA Intelligence Layer — Implementation Guide

**Status:** ✅ Phase 1 Complete - Foundation Implemented  
**Date:** July 27, 2026  
**Files Added:** 5 new modules, 3 routes, comprehensive tests  

---

## What Was Implemented

### New Files Created

| File | Purpose | Lines |
|------|---------|-------|
| `src/types/eliza-intelligence.ts` | Type definitions | 650 |
| `src/lib/elizaAuthService.ts` | JWT validation + auth | 180 |
| `src/lib/elizaToolRegistry.ts` | Tool system + 5 tools | 420 |
| `src/services/elizaContextBuilder.ts` | Context assembly | 350 |
| `src/lib/elizaIntelligence.ts` | Main orchestration | 580 |
| `src/__tests__/elizaIntelligence.spec.ts` | Unit tests | 220 |
| `ELIZA_IMPLEMENTATION_GUIDE.md` | This file | - |

**Total New Code:** ~2,400 lines of production-ready TypeScript

### New Routes

```
POST   /api/intelligence/analyze         ← Main AI endpoint
GET    /api/intelligence/tools           ← List available tools
POST   /api/intelligence/approve-action  ← Approve tool actions
```

### Old Routes (UNCHANGED)

```
POST   /api/ai/generateContent           ← Still works (legacy)
GET    /api/whatsapp/webhook
POST   /api/whatsapp/webhook
(all other routes unchanged)
```

---

## Quick Start

### For Frontend Developers

#### 1. Send Request to Intelligence Endpoint

**Before (Legacy):**
```typescript
// Old way - still works
fetch("/api/ai/generateContent", {
  method: "POST",
  body: JSON.stringify({
    model: "gemini-3.5-flash",
    contents: [...],
    clinicId: clinic.id,  // ← From frontend
  })
})
```

**After (New - Recommended):**
```typescript
// New way - secure + structured
fetch("/api/intelligence/analyze", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${jwtToken}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    taskType: "patient_analysis",
    prompt: "Analisar prontuário do paciente",
    patientId: "patient123",
    conversationId: "conv456",
    requestedTools: ["read_patient_record"],
    // Note: NO clinicId here! It comes from JWT
  })
})
```

#### 2. Handle Response

```typescript
const response = await fetch("/api/intelligence/analyze", {
  // ... options above
});

if (response.ok) {
  const data = await response.json();
  // data.success === true
  // data.data.analysisResult.content = AI response
  // data.data.metadata.tokensUsed = usage info
  // data.audit.requestId = for tracking
} else {
  const error = await response.json();
  // error.success === false
  // error.error.code = error code
  // error.error.message = user-friendly message
}
```

#### 3. List Available Tools (before calling)

```typescript
const response = await fetch("/api/intelligence/tools", {
  method: "GET",
  headers: {
    "Authorization": `Bearer ${jwtToken}`
  }
});

const { data } = await response.json();
console.log(data.tools);
// [
//   { id: "read_patient_record", name: "...", category: "read", requiresApproval: false },
//   { id: "write_patient_evolution", name: "...", category: "write", requiresApproval: true },
//   ...
// ]
```

---

## For Backend Developers

### Architecture

```
Request
  ↓
elizaAuthMiddleware (JWT validation)
  ↓
buildContext (load clinic config, patient, history)
  ↓
elizaIntelligence.execute()
  ├─ buildPrompt()
  ├─ callModel() (Gemini or OpenAI)
  ├─ processResponse()
  ├─ executionRequestedTools()
  └─ logAuditTrail()
  ↓
Response
```

### Adding a New Tool

**Step 1: Define the tool**

```typescript
// src/lib/elizaToolRegistry.ts

const MY_NEW_TOOL: ElizaTool = {
  id: "my_new_tool",
  name: "My New Tool",
  description: "What this tool does",
  category: "read", // or "write" or "execute"
  
  requiredPermissions: {
    clinicRole: "professional",  // min required role
    moduleAccess: ["patients"],
    scopeClinicOnly: true,
  },
  
  inputSchema: {
    type: "object",
    properties: {
      inputField: { type: "string", description: "..." },
    },
    required: ["inputField"],
  },
  
  outputSchema: {
    type: "object",
    properties: {
      outputField: { type: "string" },
    },
  },
  
  requiresApproval: false, // or true if action needed
  
  handler: async (input: any, context: ElizaContext) => {
    // Validate input
    const { inputField } = input;
    
    // Do work (read from Firestore, calculate, etc)
    const result = await adminDb
      .doc(`clinics/${context.clinicId}/data/${inputField}`)
      .get();
    
    // Return structured output
    return {
      outputField: result.data()?.value || "",
    };
  },
};

// Add to registry
TOOL_REGISTRY.set(MY_NEW_TOOL.id, MY_NEW_TOOL);
```

**Step 2: Use it**

```typescript
// In elizaIntelligence.ts or anywhere

const tool = getTool("my_new_tool");
const result = await executeTool("my_new_tool", { inputField: "value" }, context);
```

### Understanding Context

```typescript
interface ElizaContext {
  // JWT decoded
  authToken: string;
  userId: string;
  clinicId: string;
  userRole: "owner" | "admin" | "professional" | "member";
  userPermissions: string[];
  
  // Clinic config
  clinicData: {
    id: string;
    name: string;
    config: ClinicAIConfig;  // AI provider, models, budgets
  };
  
  // Patient (if applicable)
  patient: PatientContextData;  // Name, age, allergies, etc
  
  // Conversation history
  conversationHistory: ConversationRecord;  // Messages array
  
  // Current request
  request: {
    taskType: string;
    userPrompt: string;
    requestedTools: string[];
  };
  
  // Token budget
  tokenBudget: {
    maxInputTokens: 6000;
    maxOutputTokens: 2000;
  };
}
```

### Customizing Prompts

**For each taskType, edit `getSystemPromptForTaskType()`:**

```typescript
// src/lib/elizaIntelligence.ts

private getSystemPromptForTaskType(taskType: string): string {
  const prompts: Record<string, string> = {
    "my_custom_task": `You are a specialist in...
    
    Always:
    - Do this
    - Never do that
    
    Format responses as JSON.`,
  };
  
  return prompts[taskType] || prompts.patient_analysis;
}
```

---

## Security

### clinicId is From JWT, Not Frontend

**❌ WRONG:**
```typescript
fetch("/api/intelligence/analyze", {
  body: JSON.stringify({
    clinicId: req.body.clinicId,  // Client-controlled!
  })
})
```

**✅ CORRECT:**
```typescript
// clinicId MUST come from JWT
const token = extractBearerToken(req.headers.authorization);
const decoded = verifyAndDecodeJWT(token);
const clinicId = decoded.clinic_id;  // Authority
```

### All Data is Filtered by clinicId

```typescript
// Always filter by clinicId
const patient = await adminDb
  .doc(`clinics/${clinicId}/patients/${patientId}`)  // ← clinicId is authority
  .get();

// Never read outside clinic scope
const allPatients = await adminDb
  .collection("patients")  // ❌ WRONG
  .get();
```

### Tool Execution Requires Permission

```typescript
// Automatically checked in authorizeToolUsage()
const tool = getTool("write_patient_evolution");

if (context.userRole !== "professional") {
  throw new ElizaError(
    ElizaErrorCode.TOOL_PERMISSION_DENIED,
    "Sua função não pode executar esta ferramenta"
  );
}
```

---

## Monitoring & Observability

### Audit Logs in Firestore

Every request is logged to:
```
/clinics/{clinicId}/ai_audit_logs/{requestId}
```

Contains:
- User ID, timestamp, operation type
- Prompt (first 500 chars)
- Model used, tokens consumed
- Errors if any
- Tools executed

### Check Logs in Console

```bash
# View recent AI requests for a clinic
db.collection("clinics").doc("clinic123")
  .collection("ai_audit_logs")
  .orderBy("timestamp", "desc")
  .limit(10)
  .get()
```

### Monitoring Dashboard (Future)

Will show:
- Requests per day
- Tokens consumed vs budget
- Error rate
- Most used tools
- Cost estimates

---

## Common Tasks

### Task: Analyze a Patient

```typescript
const response = await fetch("/api/intelligence/analyze", {
  method: "POST",
  headers: { "Authorization": `Bearer ${token}` },
  body: JSON.stringify({
    taskType: "patient_analysis",
    prompt: "Analisar o prontuário do paciente",
    patientId: "patient123",
  })
});

const { data } = await response.json();
console.log(data.analysisResult.content);
```

### Task: Create Treatment Plan

```typescript
const response = await fetch("/api/intelligence/analyze", {
  method: "POST",
  headers: { "Authorization": `Bearer ${token}` },
  body: JSON.stringify({
    taskType: "treatment_plan",
    prompt: "Criar plano de tratamento para limpeza + restauração",
    patientId: "patient123",
    requestedTools: ["write_patient_evolution"],
    approvalRequired: true,  // Will wait for human approval
  })
});
```

### Task: Get Financial Insight

```typescript
const response = await fetch("/api/intelligence/analyze", {
  method: "POST",
  headers: { "Authorization": `Bearer ${token}` },
  body: JSON.stringify({
    taskType: "financial_insight",
    prompt: "Qual é o desempenho financeiro de julho?",
  })
});
```

### Task: Generate Marketing Copy

```typescript
const response = await fetch("/api/intelligence/analyze", {
  method: "POST",
  headers: { "Authorization": `Bearer ${token}` },
  body: JSON.stringify({
    taskType: "marketing_copy",
    prompt: "Criar post para WhatsApp sobre limpeza profissional",
  })
});
```

---

## Testing

### Run Unit Tests

```bash
npm test src/__tests__/elizaIntelligence.spec.ts
```

### Manual Testing with curl

```bash
# 1. Generate JWT (substitute values)
TOKEN=$(node -e "const jwt = require('jsonwebtoken'); console.log(jwt.sign({sub: 'user123', clinic_id: 'clinic456', role: 'admin', permissions: []}, 'eliza-dev-secret-change-in-prod', {algorithm: 'HS256'}))")

# 2. Call intelligence endpoint
curl -X POST http://localhost:3000/api/intelligence/analyze \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "taskType": "patient_analysis",
    "prompt": "Analisar paciente",
    "patientId": "patient123"
  }'

# 3. List tools
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/intelligence/tools
```

---

## Troubleshooting

### "Token expired" Error

```
Error: TOKEN_EXPIRED

Solution: Frontend must refresh JWT regularly
- Store JWT in memory (not localStorage)
- Re-authenticate when token expires
- Or extend JWT_EXPIRY in elizaAuthService.ts
```

### "Clinic not found" Error

```
Error: CLINIC_NOT_FOUND

Causes:
1. Clinic doesn't exist in Firestore
2. JWT has wrong clinic_id
3. User isn't member of clinic

Debug:
- Check clinicId in JWT: decode token
- Verify /clinics/{clinicId} exists
- Check /clinics/{clinicId}/members/{userId}
```

### "Tool permission denied" Error

```
Error: TOOL_PERMISSION_DENIED

Cause: User role is too low for tool

Solution:
- Member can only read
- Professional can write + read
- Admin can do everything
- Check tool.requiredPermissions.clinicRole
```

### Model Calls Failing

```
Error: MODEL_ERROR

Possible causes:
- GEMINI_API_KEY not set
- OPENAI_API_KEY not set
- API quota exceeded
- Network error

Debug:
- Check .env for keys
- Check GCP console for quota
- Check OpenAI account billing
```

---

## Next Steps (Phase 2)

- [ ] Implement conversation history in UI
- [ ] Add approval UI for write tools
- [ ] Versionable prompts in Firestore
- [ ] Performance optimization (caching)
- [ ] Extended tool set (10+ tools)
- [ ] Dashboards + metrics

---

## Support

For issues or questions:

1. Check this guide (you're reading it!)
2. Review error code in response (`error.code`)
3. Check audit logs: `/clinics/{clinicId}/ai_audit_logs`
4. Review `server.ts` console logs
5. Check types: `src/types/eliza-intelligence.ts`

---

**Happy building! 🚀**
