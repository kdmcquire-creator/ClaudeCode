# Peak 10 Intelligence App

Email & Calendar Intelligence for Peak 10 Energy.

## Quick Start

### 1. Configure
```bash
cp .env.template .env
# Edit .env with your Azure AD and Anthropic API credentials
```

### 2. Build Client
```bash
cd client
npm install
npm run build
```

### 3. Start Server
```bash
cd server
npm install
NODE_ENV=production node index.js
```

The app serves on port 3001 (or the PORT environment variable).

### 4. Install as PWA
- Desktop: Navigate to the URL in Chrome/Edge → click install icon in address bar
- Mobile: Navigate in Chrome → "Add to Home Screen"

## Architecture

```
peak10-app/
├── server/
│   ├── index.js          # Express API server (all endpoints)
│   └── package.json
├── client/
│   ├── src/
│   │   ├── App.jsx       # Complete React frontend
│   │   └── index.js      # Entry point
│   ├── public/
│   │   ├── index.html    # PWA shell
│   │   ├── manifest.json # PWA manifest
│   │   └── service-worker.js
│   └── package.json
└── .env.template          # Configuration template
```

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| /api/dashboard | GET | Aggregated dashboard data |
| /api/inbound | GET | Inbound emails by tier |
| /api/email/:id | GET | Full email + thread |
| /api/draft | POST | Generate AI response drafts |
| /api/send | POST | Send a reply |
| /api/action | POST | File, mute, snooze, dismiss |
| /api/calendar/suggestions | GET | AI meeting suggestions |
| /api/settings | GET/PUT | User settings |
| /api/digest | GET | Morning digest data |
| /api/health | GET | Health check |

See Phase3_Architecture.docx for complete documentation.
