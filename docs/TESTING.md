# Testing, verification, and troubleshooting

## Automated checks

From the project root in PowerShell:

```powershell
npm.cmd run build
```

From the `backend` directory:

```powershell
npm.cmd test
```

The Node.js test suite covers password hashing and size/email validation, token secret configuration, authentication middleware handling of invalid tokens vs. database errors, private conversation/group membership helpers, and rate-limit behavior. Run these commands again after local changes. No database integration test currently runs without an explicitly configured MongoDB instance.

The degraded-mode backend was also started without a MongoDB URI: `/api/health` returned HTTP 200 with `status: degraded` and `database: unavailable`; `/api/health/database` and a database-dependent `/api/conversations` request returned HTTP 503 with JSON errors.

## Local live-database smoke test

1. Configure `backend\.env` as described in [README](../README.md), with a local or Atlas `MONGODB_URI`, random `JWT_SECRET`, and `CLIENT_URL=http://localhost:5173`.
2. Start backend and frontend in separate PowerShell terminals; verify `/api/health/database` reports `connected`.
3. Register two different accounts in separate browser profiles. Confirm duplicate email rejection and that profile responses contain no password hashes.
4. Start a direct chat from Contacts. Send, reply to, edit, delete, and react to messages; search message text and verify history after reload.
5. Open the same conversation in both profiles. Verify Socket.IO sends, typing, and read receipts; disconnect one client and confirm the UI displays reconnecting state.
6. Create a group, manage members/admins, leave, and verify a removed member cannot read messages or download files.
7. Upload permitted and rejected file types, confirm the 10 MB limit and member-only download.
8. Create a demo payment and open/print its receipt. Verify the receipt/reference appears in backend transaction history and that the UI labels it simulated.

Items in steps 2–8 are **not verified against a live database in this workspace** because no MongoDB URI or two test accounts were configured. The commands below verify the configured environment; they do not claim external services are available.

## Troubleshooting

- **Health says `degraded` / database health returns 503:** check `MONGODB_URI`, Atlas database credentials, URL-encoded password characters, Atlas IP access list, cluster status, and network connectivity; restart the backend after editing `.env`.
- **Authentication reports JWT configuration unavailable:** set `JWT_SECRET` to a unique random value of at least 32 characters in `backend\.env`.
- **CORS error:** `CLIENT_URL` must exactly match the browser origin, including scheme and port (local Vite defaults to `http://localhost:5173`).
- **Vite uses port 5174:** this happens when 5173 is already occupied. Use the URL Vite prints; `/api` still proxies to backend port 5002. For direct (non-proxied) browser API calls, set `CLIENT_URL` to the actual frontend origin and restart the backend.
- **Frontend points at the wrong API:** set `VITE_API_BASE_URL` in the root `.env` and restart Vite.
- **Upload rejected:** use JPEG, PNG, WebP, PDF, Word, or supported audio, below 10 MB; confirm the backend process can write to `UPLOAD_DIR`.
- **Receipt missing after navigation/reload:** live receipts load from backend history; confirm database connectivity and sign in as the transaction sender/recipient. The signed-out interface uses clearly separate in-memory sample records.
- **Root `npm.cmd test` fails:** backend tests are intentionally run from `backend\`; the root package has no test script.

## Known environment and security limitations

- MongoDB Atlas credentials are not provided, so database persistence, multi-user chat, live Socket.IO delivery, group permissions, attachments, and payments have not been end-to-end verified.
- OAuth, email reset delivery, calling, and real-money provider verification need external services.
- `npm audit` previously identified advisories in the existing React Router dependency tree; review the current audit before deployment and assess any major-version migration separately.
- In-memory rate limiting, browser `localStorage` JWT storage, local-disk uploads, and absent malware inspection are not production security controls on their own.
