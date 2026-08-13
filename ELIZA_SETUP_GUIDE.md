# ELIZA Intelligence Layer - Setup & Deployment Guide

**Status:** ✅ Production Ready  
**Last Updated:** July 27, 2026

---

## Table of Contents

1. [Quick Start (5 minutes)](#quick-start)
2. [Development Setup](#development-setup)
3. [Production Deployment](#production-deployment)
4. [Testing](#testing)
5. [Troubleshooting](#troubleshooting)
6. [Architecture Overview](#architecture-overview)

---

## Quick Start

### Prerequisites

- Node.js 18+ (current LTS)
- npm 9+
- Firebase Project with Admin SDK
- Google Gemini API key (or OpenAI API key)
- .env.local with required variables

### 1. Install Dependencies

```bash
cd Eliza-main
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env.local
# Edit .env.local with your credentials
```

**Required variables:**
- `ELIZA_JWT_SECRET` (generate: `openssl rand -base64 32`)
- `GEMINI_API_KEY` or `OPENAI_API_KEY`
- `GOOGLE_APPLICATION_CREDENTIALS` (path to Firebase service account)

### 3. Run Development Server

```bash
npm run dev
```

Server starts at `http://localhost:3000`

### 4. Test Authentication

```bash
# Generate a token
TOKEN=$(node -e "
  const jwt = require('crypto');
  const payload = {
    sub: 'user123',
    clinic_id: 'clinic456',
    role: 'admin',
    permissions: []
  };
  console.log(Buffer.from(JSON.stringify(payload)).toString('base64'));
")

# Or use the login endpoint
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "firebaseUid": "firebase-user-id",
    "clinicId": "clinic-id"
  }'
```

---

## Development Setup

### Project Structure

```
Eliza-main/
├── src/
│   ├── types/
│   │   └── eliza-intelligence.ts       # Type definitions
│   ├── lib/
│   │   ├── elizaIntelligence.ts        # Main orchestration
│   │   ├── elizaAuthService.ts         # JWT validation
│   │   ├── elizaToolRegistry.ts        # Tools system
│   │   └── elizaFrontendClient.ts      # Frontend client
│   ├── services/
│   │   ├── jwtService.ts               # JWT generation
│   │   ├── elizaContextBuilder.ts      # Context assembly
│   │   └── elizaAuthService.ts         # Auth middleware
│   ├── controllers/
│   │   └── authController.ts           # Auth endpoints
│   ├── hooks/
│   │   └── useEliza.ts                 # React hook
│   ├── examples/
│   │   └── PatientAnalysisExample.tsx  # Example component
│   └── __tests__/
│       └── elizaIntelligence.spec.ts   # Unit tests
├── server.ts                            # Express server
├── package.json
├── .env.example
├── ELIZA_SETUP_GUIDE.md                # This file
└── ELIZA_IMPLEMENTATION_GUIDE.md       # Implementation docs
```

### Available Scripts

```bash
# Development
npm run dev              # Start dev server (tsx)

# Production
npm run build            # Build frontend + backend
npm start                # Run production build

# Quality
npm run lint             # TypeScript check
npm test                 # Run tests

# Cleanup
npm run clean            # Remove dist/ folder
```

### Development Workflow

1. **Create new feature**
   ```bash
   git checkout -b feature/your-feature
   ```

2. **Code with type checking**
   ```bash
   npm run lint  # Check for TS errors
   ```

3. **Test locally**
   ```bash
   npm run dev   # Hot reload dev server
   ```

4. **Test endpoints**
   ```bash
   curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/intelligence/analyze
   ```

5. **Run tests**
   ```bash
   npm test
   ```

6. **Push to production**
   ```bash
   npm run build
   git push
   ```

---

## Production Deployment

### Pre-Deployment Checklist

- [ ] Set `NODE_ENV=production` in .env
- [ ] Generate strong `ELIZA_JWT_SECRET` (min 32 chars)
- [ ] Configure all API keys (Gemini/OpenAI, Firebase)
- [ ] Enable HTTPS/SSL
- [ ] Set up database backups (Firestore)
- [ ] Configure logging/monitoring
- [ ] Set up error tracking (Sentry, etc)
- [ ] Review security rules (Firestore)
- [ ] Performance test under load

### Docker Deployment

#### Dockerfile

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy files
COPY package*.json ./
COPY . .

# Install dependencies
RUN npm ci --only=production

# Build
RUN npm run build

# Expose port
EXPOSE 3000

# Start server
CMD ["npm", "start"]
```

#### Build & Run

```bash
# Build image
docker build -t eliza:latest .

# Run container
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -e ELIZA_JWT_SECRET=your-secret \
  -e GEMINI_API_KEY=your-key \
  -e GOOGLE_APPLICATION_CREDENTIALS=/app/creds.json \
  -v $(pwd)/serviceAccountKey.json:/app/creds.json \
  eliza:latest
```

### Google Cloud Run Deployment

```bash
# Build and push to Cloud Run
gcloud run deploy eliza \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,ELIZA_JWT_SECRET=... \
  --memory 512Mi \
  --timeout 300
```

### Environment Variables (Production)

```env
NODE_ENV=production
PORT=3000

# Security
ELIZA_JWT_SECRET=<generated-strong-secret>

# APIs
GEMINI_API_KEY=<your-gemini-key>
OPENAI_API_KEY=<your-openai-key>
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json

# Monitoring
LOG_LEVEL=warn
SENTRY_DSN=<your-sentry-dsn>
```

### Monitoring in Production

**Error Tracking:**
- Set up Sentry or similar
- Monitor `/api/intelligence/analyze` error rate
- Alert on token validation failures

**Performance:**
- Monitor request latency (target: <2s for analysis)
- Monitor token usage per clinic
- Alert on quota exceeded

**Security:**
- Monitor auth failures
- Alert on unusual patterns
- Log all actions in Firestore

### Scaling Considerations

**For up to 10 clinics:**
- Single instance with 512MB memory sufficient
- Cloud Run or standard Node.js hosting

**For 10-100 clinics:**
- Horizontal scaling with load balancer
- Redis for session/cache management
- Consider Firestore sharding for hot partitions

**For 100+ clinics:**
- Kubernetes or serverless with auto-scaling
- Dedicated Firestore instances
- CDN for static assets
- Separate analytics database

---

## Testing

### Unit Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test elizaIntelligence.spec.ts

# Watch mode
npm test -- --watch
```

### Integration Testing

**Manual test flow:**

```bash
# 1. Start server
npm run dev

# 2. Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "firebaseUid": "test-user",
    "clinicId": "test-clinic"
  }'

# 3. Call intelligence API
curl -X POST http://localhost:3000/api/intelligence/analyze \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "taskType": "patient_analysis",
    "prompt": "Analyze this patient",
    "patientId": "patient-123"
  }'
```

### Load Testing

```bash
# Using Apache Bench
ab -n 1000 -c 10 \
  -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/intelligence/tools

# Using autocannon
npm install -g autocannon
autocannon -c 10 -d 30 http://localhost:3000/api/intelligence/tools
```

---

## Troubleshooting

### "Token expired" Error

**Cause:** JWT token older than 5 hours

**Solution:**
```typescript
// Frontend should refresh token before expiry
await elizaClient.refreshToken();
```

### "CLINIC_NOT_FOUND" Error

**Cause:** Clinic doesn't exist in Firestore

**Debug:**
```bash
# Check if clinic exists
firebase database:get /clinics/clinic-id
```

### "GEMINI_API_KEY not configured"

**Cause:** Missing env variable

**Solution:**
```bash
# Add to .env.local
GEMINI_API_KEY=your_key_here

# Or set env var
export GEMINI_API_KEY=your_key_here
npm run dev
```

### Model Calls Failing

**Debugging steps:**

1. Check API keys are valid
2. Verify rate limits not exceeded
3. Check network connectivity
4. Review error logs in Firestore audit trail

```bash
# Check recent errors
firebase firestore:query 'clinics/clinic-id/ai_audit_logs' \
  --where='status' '==' 'failed' \
  --order-by='timestamp' 'desc' \
  --limit=10
```

### Slow Responses

**Check:**
1. Model selection (use fast model if possible)
2. Token budget (may need smaller context)
3. Network latency (try closer region)
4. Firestore read/write latency

**Optimize:**
```typescript
// Use fast model for simple tasks
request.preferredProvider = "gemini";  // Use gemini-3.5-flash

// Reduce context
request.context = { reduced: true };  // Load only essentials
```

---

## Architecture Overview

### Request Flow

```
Frontend Component
  ↓
[ElizaFrontendClient]
  ↓
POST /api/intelligence/analyze
  ↓
[elizaAuthMiddleware] → Validates JWT
  ↓
[elizaIntelligence.execute()]
  ├─ [buildContext] → Load clinic/patient/history
  ├─ [buildPrompt] → Create AI prompt
  ├─ [callModel] → Gemini/OpenAI (with fallback)
  ├─ [processResponse] → Parse result
  ├─ [executeTool] → Run requested tools
  └─ [logAuditTrail] → Save to Firestore
  ↓
Response with analysis + metadata
  ↓
Frontend displays results
```

### Data Flow for Multi-Tenant

```
User A (Clinic X)
  → JWT: clinic_id=clinic-x
  → Can only access /clinics/clinic-x/patients
  → Cannot see Clinic Y data

User B (Clinic Y)
  → JWT: clinic_id=clinic-y
  → Can only access /clinics/clinic-y/patients
  → Cannot see Clinic X data
```

### Security Model

1. **Authentication:** JWT from Firebase UID + clinic membership check
2. **Authorization:** Role-based (owner > admin > professional > member)
3. **Isolation:** clinicId from JWT enforced at all levels
4. **Audit:** All actions logged in `/clinics/{clinicId}/ai_audit_logs`
5. **Encryption:** TLS in transit, encryption at rest (Firestore)

---

## Support & Resources

**Documentation:**
- [ELIZA_IMPLEMENTATION_GUIDE.md](./ELIZA_IMPLEMENTATION_GUIDE.md) - API usage
- [ELIZA_INTELLIGENCE_LAYER_SPEC.md](../outputs/02_ELIZA_INTELLIGENCE_LAYER_SPEC.md) - Architecture
- [README.md](./README.md) - Project overview

**Tools:**
- Postman collection: See examples in IMPLEMENTATION_GUIDE
- Firebase Console: https://console.firebase.google.com
- Google Cloud Console: https://console.cloud.google.com

**Getting Help:**
1. Check troubleshooting section above
2. Review error logs in Firestore audit trail
3. Check API key validity
4. Enable debug mode: `DEBUG=true npm run dev`

---

**Happy deploying! 🚀**
