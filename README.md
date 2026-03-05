# Tjenesteguide Admin

Admin web app for managing municipal services ("tjenester") stored in a JSON file.

## Tech Stack

- **Backend**: Node.js + Express + TypeScript
- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Validation**: Zod
- **Data Storage**: JSON file (`data/tjenester.json`)

## Project Structure

```
.
├── server/          # Express backend
│   ├── src/
│   │   ├── models/      # TypeScript interfaces
│   │   ├── validation/  # Zod schemas
│   │   ├── repository/   # Data access layer
│   │   ├── routes/      # API routes
│   │   └── index.ts     # Server entry point
│   └── package.json
├── client/          # React frontend
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── pages/       # Page components
│   │   ├── api/         # API client functions
│   │   └── types/       # TypeScript types
│   └── package.json
├── server/data/     # Data directory (created automatically)
│   └── tjenester.json  # Services data file
└── package.json     # Root package.json with scripts
```

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   cd server && npm install
   cd ../client && npm install
   ```

2. **Development mode** (runs both server and client):
   ```bash
   npm run dev
   ```
   - Server: http://localhost:3001
   - Client: http://localhost:5173

### AI Chat Environment Variables

The AI chat page uses:
- Local guardrail model first (default: Ollama)
- Gemini for final answer, but only with included JSON context

Set these variables before running server:

```bash
export GEMINI_API_KEY="your_google_ai_studio_key"
export GEMINI_MODEL="gemini-2.5-pro"            # optional (default set)

# Privacy LLM (OpenAI-compatible endpoint)
export PRIVACY_LLM_PROVIDER="openai"            # optional (default set)
export PRIVACY_MODEL="google/gemma-3-27b-it"    # optional (default set)
export PRIVACY_ENDPOINT="http://10.200.16.103:8000/v1"  # optional (default set)
export PRIVACY_API_KEY=""                       # optional
export PRIVACY_REQUIRED="true"                  # optional, default true
export PRIVACY_TIMEOUT_MS="7000"                # optional
```

Ollama alternative (if you want local Ollama instead):

```bash
export PRIVACY_LLM_PROVIDER="ollama"
export PRIVACY_MODEL="llama3.2:3b"
export PRIVACY_ENDPOINT="http://127.0.0.1:11434/api/chat"
ollama pull llama3.2:3b
ollama serve
```

3. **Build for production**:
   ```bash
   npm run build
   ```

4. **Start production server**:
   ```bash
   npm start
   ```
   The server will serve the built frontend and API on port 3001.

## Docker (Production)

Build image:

```bash
docker build -t tjenesteguide:prod .
```

Run container:

```bash
docker run --rm -p 3001:3001 tjenesteguide:prod
```

Run with persistent JSON data:

```bash
docker run --rm -p 3001:3001 -v $(pwd)/server/data:/app/server/data tjenesteguide:prod
```

## API Endpoints

All endpoints are prefixed with `/api/tjenester`:

- `GET /api/tjenester` - List all services (supports `?q=`, `?status=`, `?tema=`, `?tjenestetype=` query params)
  - Also supports `?trinn_niva=` (`grunnmur`, `trinn1`..`trinn6`)
- `GET /api/tjenester/:id` - Get a single service
- `POST /api/tjenester` - Create a new service
- `PUT /api/tjenester/:id` - Update a service (full replacement)
- `PATCH /api/tjenester/:id` - Partially update a service
- `DELETE /api/tjenester/:id` - Delete a service

AI chat endpoint:

- `POST /api/chat/ask` - Ask question based only on `tjenester.json`
  - Request body: `{ "message": "..." }`
  - Flow:
    1. Local guardrail checks for sensitive user data
    2. If safe, selected JSON context is sent to Gemini
    3. Model is instructed to answer only from included data

## Data Model

The `Tjeneste` interface uses Norwegian field names and matches the JSON structure exactly. See `server/src/models/tjeneste.ts` for the complete type definition.

### Document-aligned fields

The importer reads the DOCX heading structure and writes service-level entries
directly to `server/data/tjenester.json` using the current schema, including
`trinn_nivå`.

The import script is:

```bash
python3 scripts/import_tjenesteguide_docx.py
```

## Features

- ✅ List, search, and filter services
- ✅ Create, edit, and delete services
- ✅ Full form with all field groups
- ✅ Validation on both client and server
- ✅ Automatic 6-digit ID generation
- ✅ File-based persistence (JSON)
- ✅ AI chat with local privacy guardrail + Gemini answers from JSON only

## Notes

- The `server/data/tjenester.json` file is created automatically on first run
- IDs are assigned automatically as zero-padded 6-digit numbers (`000001`, `000002`, ...)
- All field names must match the Norwegian keys exactly
- The app preserves the exact JSON structure as defined in the data model

