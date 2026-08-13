# Testing Security Fixes - Complete Guide

**Status:** Ready for integration testing  
**Last Updated:** July 29, 2026

---

## 🚀 Quick Start Testing

### 1. Compile TypeScript
```bash
npm run lint  # Check for TS errors
# Expected: No errors
```

### 2. Run Unit Tests
```bash
npm test -- src/__tests__/security.spec.ts
# Expected: Tests pass (some are placeholders - see TODOs below)
```

### 3. Start Development Server
```bash
npm run dev
# Server at http://localhost:3000
```

---

## 📋 P0 - Critical Security Tests

### Test 1: User Impersonation Prevention

**Setup:**
- Have Firebase project configured
- Users in Firestore: clinic-abc/members/{uid1} and clinic-abc/members/{uid2}

**Test 1.1: Login without Firebase token → 401**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"clinicId": "clinic-abc"}'

# Expected Response (401):
# {
#   "success": false,
#   "error": "Authorization header com Firebase ID Token é obrigatório"
# }
```

**Test 1.2: Login with invalid Firebase token → 401**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid.token.here" \
  -d '{"clinicId": "clinic-abc"}'

# Expected Response (401):
# {
#   "success": false,
#   "error": "Firebase ID Token inválido ou expirado"
# }
```

**Test 1.3: Valid Firebase token but user not in clinic → 403**
```bash
# Get valid Firebase token for user NOT in clinic-abc
FIREBASE_TOKEN=$(firebase auth:create-user --uid=other-user --email=other@test.com --json | jq '.idToken')

curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FIREBASE_TOKEN" \
  -d '{"clinicId": "clinic-abc"}'

# Expected Response (403):
# {
#   "success": false,
#   "error": "Usuário não é membro desta clínica"
# }
```

**Test 1.4: Deactivated user → 403**
```bash
# Create user, set active=false in Firestore
# Try to login with their Firebase token

# Expected Response (403):
# {
#   "success": false,
#   "error": "Usuário inativo nesta clínica"
# }
```

**✅ Verdict:** User impersonation is prevented if all 4 tests pass

---

### Test 2: Concurrent Request Isolation

**Setup:**
- Start server
- Have Node.js script that sends 2+ simultaneous requests

**Test Script:**
```javascript
const concurrent = async () => {
  const token = "YOUR_VALID_TOKEN";
  
  const req1 = fetch('http://localhost:3000/api/intelligence/analyze', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      taskType: 'patient_analysis',
      prompt: 'Request 1 - should have unique requestId'
    })
  });

  const req2 = fetch('http://localhost:3000/api/intelligence/analyze', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      taskType: 'patient_analysis',
      prompt: 'Request 2 - should have unique requestId'
    })
  });

  const [res1, res2] = await Promise.all([req1, req2]);
  const data1 = await res1.json();
  const data2 = await res2.json();

  console.log('Req 1 ID:', data1.audit.requestId);
  console.log('Req 2 ID:', data2.audit.requestId);

  // Verify they're different
  if (data1.audit.requestId === data2.audit.requestId) {
    console.error('❌ FAIL: Same requestId for concurrent requests!');
    return false;
  }

  if (data1.audit.clinicId !== data2.audit.clinicId) {
    console.error('❌ FAIL: Different clinicId in audit!');
    return false;
  }

  console.log('✅ PASS: Concurrent requests properly isolated');
  return true;
};

concurrent();
```

**✅ Verdict:** Pass if requestIds are unique and audit trails don't mix

---

### Test 3: Approval Workflow

**Setup:**
- Have write tool configured
- Admin user in Firestore

**Test 3.1: Create proposal**
```bash
PROPOSAL_ID="manual-test-$(date +%s)"

# This is internal - use direct Firestore
# Or trigger through intelligence API with write action

# Verify in Firestore:
# /clinics/clinic-abc/action_proposals/{PROPOSAL_ID}
# status: "pending"
```

**Test 3.2: Try to execute without approval → Should fail**
```bash
curl -X POST http://localhost:3000/api/intelligence/approve-action \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"actionId": "'$PROPOSAL_ID'"}' \
  -X POST http://localhost:3000/api/intelligence/execute-action \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"actionId": "'$PROPOSAL_ID'"}'

# Expected: Error - "Proposal status is pending, cannot execute"
```

**Test 3.3: Approve the proposal**
```bash
curl -X POST http://localhost:3000/api/intelligence/approve-action \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "actionId": "'$PROPOSAL_ID'",
    "approvalNotes": "Approved for testing"
  }'

# Expected (200):
# {
#   "success": true,
#   "data": { "approved": true }
# }

# Verify in Firestore:
# status: "approved"
# approvedBy: "admin-uid"
# approvedAt: <timestamp>
```

**Test 3.4: Execute after approval**
```bash
curl -X POST http://localhost:3000/api/intelligence/execute-action \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "actionId": "'$PROPOSAL_ID'",
    "idempotencyKey": "test-idempotency-1"
  }'

# Expected (200):
# {
#   "success": true,
#   "data": { "executed": true }
# }

# Verify in Firestore:
# status: "executed"
# executedAt: <timestamp>
# idempotencyKey: "test-idempotency-1"
```

**Test 3.5: Idempotency - same request twice**
```bash
# Same idempotency key
curl -X POST http://localhost:3000/api/intelligence/execute-action \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "actionId": "'$PROPOSAL_ID'",
    "idempotencyKey": "test-idempotency-1"
  }'

# Expected: Same result as before, no duplicate execution
# In logs: "Cached execution for idempotency key..."
```

**✅ Verdict:** Pass if workflow goes pending → approved → executed → cached

---

### Test 4: Financial Tool Disabled

**Test 4.1: Try to call disabled tool**
```bash
curl -X POST http://localhost:3000/api/intelligence/analyze \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "taskType": "financial_insight",
    "prompt": "Show me our finances",
    "requestedTools": ["get_financial_summary"]
  }'

# Expected (503):
# {
#   "success": false,
#   "error": {
#     "code": "TOOL_DISABLED",
#     "message": "Ferramenta de resumo financeiro está desativada"
#   }
# }
```

**✅ Verdict:** Pass if tool returns error instead of mock data

---

## 📋 P1 - High Priority Tests

### Test 5: Request Validation

**Test 5.1: Missing required field**
```bash
curl -X POST http://localhost:3000/api/intelligence/analyze \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "test"}' # Missing taskType

# Expected (400):
# {
#   "success": false,
#   "error": "validation failed: Missing required field: taskType"
# }
```

**Test 5.2: Invalid enum value**
```bash
curl -X POST http://localhost:3000/api/intelligence/analyze \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "taskType": "invalid_type",
    "prompt": "test"
  }'

# Expected (400):
# {
#   "success": false,
#   "error": "validation failed: Must be one of: patient_analysis,..."
# }
```

**Test 5.3: Prompt too long**
```bash
LONG_PROMPT=$(printf 'x%.0s' {1..10001})  # 10001 chars

curl -X POST http://localhost:3000/api/intelligence/analyze \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"taskType\": \"patient_analysis\",
    \"prompt\": \"$LONG_PROMPT\"
  }"

# Expected (400):
# error: "String must be at most 5000 characters"
```

**✅ Verdict:** Pass if all validation errors are caught

---

### Test 6: Permission Reconciliation

**Setup:**
- User in clinic with admin role
- Admin panel to change role to "member"

**Test 6.1: Role change takes effect immediately**
```bash
# 1. User logs in as admin
TOKEN=$(get_admin_token)
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $TOKEN"
# Should show role: "admin"

# 2. Admin changes user role to "member" in Firestore
# clinics/clinic-abc/members/{uid}/role = "member"

# 3. User makes next request with SAME TOKEN
curl -X POST http://localhost:3000/api/intelligence/analyze \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "taskType": "financial_insight",  # Requires admin role
    "prompt": "finances"
  }'

# Expected (403):
# "User role is member, requires admin for this action"
```

**✅ Verdict:** Pass if revoked permissions take effect immediately

---

### Test 7: Request Sanitization

**Test 7.1: Client cannot send userId**
```bash
curl -X POST http://localhost:3000/api/intelligence/analyze \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "taskType": "patient_analysis",
    "prompt": "test",
    "userId": "hacker-trying-to-change-user"
  }'

# Expected: userId is stripped on server
# In response audit: "userId": <actual-token-user>, not "hacker-trying-to-change-user"
```

**✅ Verdict:** Pass if malicious userId is ignored

---

## 🧪 Multi-Tenant Isolation Tests

### Test 8: Clinic A ≠ Clinic B

**Setup:**
- Create two clinics: clinic-a, clinic-b
- Create patient P-1 in clinic-a
- Create user U-A in clinic-a, U-B in clinic-b

**Test 8.1: User A cannot see Patient 1**
```bash
TOKEN_A=$(login as U-A to clinic-a)

curl -X POST http://localhost:3000/api/intelligence/analyze \
  -H "Authorization: Bearer $TOKEN_A" \
  -d '{
    "taskType": "patient_analysis",
    "prompt": "Analyze patient",
    "patientId": "P-1"
  }' # P-1 is in clinic-a, U-A is in clinic-a - should work

TOKEN_B=$(login as U-B to clinic-b)

curl -X POST http://localhost:3000/api/intelligence/analyze \
  -H "Authorization: Bearer $TOKEN_B" \
  -d '{
    "taskType": "patient_analysis",
    "prompt": "Analyze patient",
    "patientId": "P-1"  # P-1 is in clinic-a but U-B is in clinic-b
  }'

# Expected (403 or 404):
# "Patient not found in this clinic" or similar
```

**Test 8.2: Audit logs are isolated**
```bash
# Check Firestore:
# /clinics/clinic-a/ai_audit_logs should ONLY have requests from clinic-a users
# /clinics/clinic-b/ai_audit_logs should ONLY have requests from clinic-b users

# Verify: clinicId in each audit log matches the collection it's in
```

**✅ Verdict:** Pass if complete isolation verified

---

## 📝 Test Execution Checklist

Use this checklist to track test execution:

```
P0 - CRITICAL
- [ ] Test 1.1 - No Firebase token → 401
- [ ] Test 1.2 - Invalid token → 401
- [ ] Test 1.3 - Not in clinic → 403
- [ ] Test 1.4 - User deactivated → 403
- [ ] Test 2 - Concurrent isolation
- [ ] Test 3.1-3.5 - Approval workflow
- [ ] Test 4 - Financial tool disabled

P1 - HIGH
- [ ] Test 5.1 - Missing field → 400
- [ ] Test 5.2 - Invalid enum → 400
- [ ] Test 5.3 - String too long → 400
- [ ] Test 6 - Permission changes immediate
- [ ] Test 7 - Request sanitization

MULTI-TENANT
- [ ] Test 8.1 - Clinic A cannot see Clinic B patients
- [ ] Test 8.2 - Audit logs isolated

TOTAL: 14 critical tests
```

---

## 🚀 Frontend Integration

### Required Changes for Frontend

The frontend must now send Firebase ID Token instead of firebaseUid.

**Old Flow (❌ No longer works):**
```typescript
// OLD - DEPRECATED
await fetch('/api/auth/login', {
  body: JSON.stringify({
    firebaseUid: user.uid,  // ❌ REMOVED
    clinicId: 'clinic-abc'
  })
});
```

**New Flow (✅ Correct):**
```typescript
// NEW - CORRECT
const firebaseToken = await user.getIdToken(true);

await fetch('/api/auth/login', {
  headers: {
    'Authorization': `Bearer ${firebaseToken}`,  // ✅ Firebase token
  },
  body: JSON.stringify({
    clinicId: 'clinic-abc'  // Only clinicId in body
  })
});
```

**Update ElizaFrontendClient:**
```typescript
// src/lib/elizaFrontendClient.ts needs update:

async login(firebaseToken: string, clinicId: string) {
  const response = await fetch(`${this.baseUrl}/auth/login`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firebaseToken}`,  // ✅ NEW
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ clinicId })
  });

  const { data } = await response.json();
  this.setToken(data.accessToken);  // Store access token
  return data;
}
```

---

## ✅ Test Results Template

```markdown
# Security Test Results - [DATE]

## P0 - Critical
- [ ] Impersonation Prevention: PASS / FAIL / N/A
- [ ] Concurrent Isolation: PASS / FAIL / N/A
- [ ] Approval Workflow: PASS / FAIL / N/A
- [ ] Financial Tool: PASS / FAIL / N/A

## P1 - High  
- [ ] Request Validation: PASS / FAIL / N/A
- [ ] Permission Reconciliation: PASS / FAIL / N/A
- [ ] Request Sanitization: PASS / FAIL / N/A

## Multi-Tenant
- [ ] Clinic Isolation: PASS / FAIL / N/A
- [ ] Audit Separation: PASS / FAIL / N/A

## Overall: PASS / FAIL

## Issues Found:
1. [Issue description]

## Ready for Production: YES / NO

Tester: [Name]
Date: [Date]
```

---

## 🆘 Troubleshooting

**Issue:** Firebase token validation fails  
**Solution:** Check `GOOGLE_APPLICATION_CREDENTIALS` points to valid service account

**Issue:** Concurrent requests still have mixed audit trails  
**Solution:** Verify all `this.requestId` and `this.audit` are now `requestId` and `audit`

**Issue:** Permission changes don't take effect  
**Solution:** Verify `reconcileUserPermissions()` is being called before access check

**Issue:** Financial tool still returns data  
**Solution:** Check `get_financial_summary` has `disabled: true` in tool definition

---

**Status:** ✅ Ready for testing  
**Last Updated:** July 29, 2026

Next: Execute test suite and report results
