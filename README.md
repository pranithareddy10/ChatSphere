# ChatSphere

ChatSphere is a responsive React chat interface backed by an Express API, MongoDB/Mongoose, and authenticated Socket.IO. It includes account registration and profiles, direct and group conversations, persistent messages, file/voice-note uploads, and a server-recorded **simulated-only** payment/receipt flow.

The existing branded frontend is preserved. When signed out, it can show the original local demo conversations and payment examples; these are interface samples only and are not database records or live accounts.

## Features and current verification

- Authentication: bcrypt password hashing, JWT sessions, profile API, duplicate-email handling, protected endpoints, and rate-limited login/registration.
- Direct and group chat: MongoDB-backed conversation history, idempotent message sends, replies, reactions, sender-only edit/delete, unread counts, read receipts, typing, and authenticated Socket.IO events.
- Group administration: create groups, add/remove/promote/demote members, leave groups, and enforce membership/admin checks.
- Chat controls: search conversations and messages, emoji/sticker picker, voice recording, validated attachment upload/download, notifications, and saved light/dark theme.
- Demo payments: server-created transaction references, simulated verification, history, and printable receipts. **No money moves and no banking/card credentials are collected.**
- Verification run: `npm.cmd run build` succeeds; backend `npm.cmd test` succeeds (18 tests). Degraded-mode health reports MongoDB unavailable and database-dependent routes return 503. Live database and multi-account behavior remain unverified until configured.

Some features are intentionally partial or blocked: online presence, group image upload, cross-device notification/privacy preferences, email recovery, OAuth, voice/video calls, durable cloud file storage, and real payment-provider processing. See [the feature checklist](./BACKEND_IMPLEMENTATION_CHECKLIST.md) for exact status.

## Technology and architecture

- Frontend: React 18, React Router, Vite, CSS custom properties, `lucide-react`, and `socket.io-client`.
- Backend: Node.js, Express 4, Mongoose 8, MongoDB, JWT, bcryptjs, Multer, and Socket.IO 4.
- Persistence: users, conversations, messages, and transactions use Mongoose models. Attachment bytes are stored on local disk in development; message metadata is stored in MongoDB.
- API base URL: `VITE_API_BASE_URL` (local default `/api`, proxied by Vite to `http://localhost:5002`).

See [system architecture](./docs/SYSTEM_ARCHITECTURE.md), [database design](./docs/DATABASE_DESIGN.md), and [API documentation](./docs/API_DOCUMENTATION.md).

## Folder structure

```text
src/                     React UI, styles, demo data, API service
public/                  Static public assets
backend/config/          MongoDB connection
backend/middleware/      Authentication, errors, and rate limiting
backend/models/          User, conversation, message, transaction
backend/routes/          Auth, conversations, groups, payments, uploads
backend/tests/           Node test runner tests
docs/                    Architecture, API, setup, testing, and B.Tech report
dist/                    Generated Vite production build
```

## Requirements and environment

- Node.js 18+ and npm.
- MongoDB Atlas or a local MongoDB instance for registration, live API features, and persistence.

From the project root in PowerShell:

```powershell
Copy-Item backend\.env.example backend\.env
```

Edit `backend\.env` locally. Required for authentication and MongoDB-backed API use:

```dotenv
PORT=5002
CLIENT_URL=http://localhost:5174
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/chatsphere
JWT_SECRET=<unique-random-secret-at-least-32-characters>
JWT_EXPIRES_IN=7d
UPLOAD_DIR=./uploads
NODE_ENV=development
```

The backend loads `backend\.env` by path regardless of the terminal's current directory; it reads `MONGODB_URI`, not a root Vite variable. The root `.env` is only for frontend build-time settings such as `VITE_API_BASE_URL`.

Generate a local JWT secret with Node.js, then paste it into the ignored `backend\.env` file (never into source control):

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

The frontend defaults to `/api`; Vite proxies API and Socket.IO requests to `http://localhost:5002` during local development, avoiding browser CORS/host mismatches. Vite defaults to port 5173, but if that port is occupied it automatically selects another (this workspace currently uses 5174). Open the exact URL printed by Vite. `CLIENT_URL` is the allowed browser origin for direct API/socket connections; set it to the URL/port Vite actually uses if bypassing the development proxy. To override the API URL (normally for production), copy `.env.example` to `.env` in the project root and set `VITE_API_BASE_URL` to the deployed backend's public `/api` URL. Vite reads frontend environment variables at startup.

### Start locally (two PowerShell terminals)

Terminal 1 — backend:

```powershell
cd C:\path\to\chatApplication\backend
npm.cmd install
npm.cmd start
```

Wait for `ChatSphere backend running on http://localhost:5002`. If MongoDB is not configured, the backend will explicitly report degraded mode and registration will remain unavailable.

Terminal 2 — frontend, from the project root:

```powershell
cd C:\path\to\chatApplication
npm.cmd install
npm.cmd run dev
```

Open the exact local URL printed by Vite (for example, `http://localhost:5174/register`). Health checks are `http://localhost:5002/api/health` and `http://localhost:5002/api/health/database`; through the Vite proxy, `http://localhost:5174/api/health` should return the same health response. With no MongoDB URI or an unreachable database, the server can start in degraded mode. Health reports the database as unavailable and database-dependent API routes return HTTP 503 rather than pretending persistence works.

### MongoDB Atlas quick setup

1. Create an Atlas project and cluster.
2. Create a database user with a strong unique password; URL-encode special characters in the connection string.
3. Add only your development IP to Atlas Network Access (avoid `0.0.0.0/0` except in a controlled temporary test).
4. Copy the Node.js driver connection string into `MONGODB_URI`, replacing the database name with `chatsphere`.
5. Restart the backend and confirm `/api/health/database` reports `connected`.

If the health endpoint works through Vite but registration returns HTTP 503 with “Database is unavailable,” the frontend reached Express successfully; configure/check `backend\.env` and Atlas connectivity. If the UI reports that the backend cannot be reached, confirm the backend terminal says it is listening on port 5002, then restart Vite after changing `vite.config.js` or the root `.env`.

Never commit `.env`, credentials, JWTs, or user data. See [configuration and startup details](./docs/USER_GUIDE.md).

## Tests and production build

From the project root:

```powershell
npm.cmd run build
```

From `backend\`:

```powershell
npm.cmd test
```

The backend tests cover password hashing/validation, token configuration, authentication middleware error handling, access checks, and rate limiting. A passing build/test suite does not substitute for live MongoDB, two-account Socket.IO, group, or attachment integration tests.

## Security and deployment limits

- JWT bearer tokens are stored in browser `localStorage`; an XSS vulnerability could expose them. A production deployment should consider secure, HttpOnly cookie sessions and a comprehensive CSP.
- In-memory rate limits are process-local and are not shared across multiple backend instances.
- Local disk uploads need private, durable object storage and malware/content inspection before production. Requests enforce a file-type allow-list and 10 MB cap; do not treat client MIME metadata as a complete malware defense.
- Configure HTTPS, strong secrets, exact frontend CORS origin, MongoDB least-privilege access, persistent private upload storage, logs/monitoring, backups, and production-grade rate limiting before deployment.
- The logout endpoint acknowledges client-side token removal; JWTs are stateless and are not revoked server-side.
- OAuth, email password reset, calling providers, and real payments are not configured. Demo transaction verification is backend-controlled but simulated and does not prove a real transfer.

### Deploy frontend and backend separately

1. Deploy the Node backend as a persistent service with the backend environment variables above. Set `CLIENT_URL` to the deployed frontend's exact HTTPS origin, use a strong secret, and configure Atlas network access for the backend host's egress IP. Do not expose `MONGODB_URI` or `JWT_SECRET` as frontend build variables.
2. Configure private persistent attachment storage and HTTPS before enabling uploads in production. The current local-disk storage is not suitable for ephemeral server instances.
3. Build the frontend with `VITE_API_BASE_URL=https://<your-backend-host>/api` in the frontend hosting provider's build environment, then run the normal Vite production build. This value is public API configuration, not a secret. Rebuild after changing it.
4. Ensure the backend host/proxy supports WebSocket upgrades for Socket.IO and verify the deployment platform's load-balancing behavior; multi-instance deployments need a compatible Socket.IO adapter and shared rate limiting.
5. Verify `/api/health` and `/api/health/database` after deployment, then perform a two-account registration/chat smoke test.

## Documentation

- [Feature implementation checklist](./BACKEND_IMPLEMENTATION_CHECKLIST.md)
- [API endpoints and Socket.IO events](./docs/API_DOCUMENTATION.md)
- [MongoDB collections and indexes](./docs/DATABASE_DESIGN.md)
- [Architecture](./docs/SYSTEM_ARCHITECTURE.md)
- [Local user guide and troubleshooting](./docs/USER_GUIDE.md)
- [Testing and verification limits](./docs/TESTING.md)
- [B.Tech project report](./docs/PROJECT_DOCUMENTATION.md)
