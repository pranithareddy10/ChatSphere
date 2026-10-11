# User guide

## Start the app

1. Copy `backend\.env.example` to `backend\.env` and configure `MONGODB_URI` plus a unique `JWT_SECRET` for live data. The backend loads this file explicitly; do not put these values in the frontend root `.env`.
2. In terminal one, run `cd backend`, `npm.cmd install`, and `npm.cmd start`.
3. In terminal two, from the project root, run `npm.cmd install` and `npm.cmd run dev`.
4. Open the URL Vite prints (5173 by default, or the next available port such as 5174). Check server/database status at `http://localhost:5002/api/health` and `http://localhost:5002/api/health/database`, or through Vite at `<printed-vite-origin>/api/health`.

When signed out, the dashboard uses its built-in mock chats. Register/sign in with the backend to load real conversations and registered users.

## Chat

- Use Contacts → Message to start a direct conversation; use New group to create a group with registered users.
- Select a conversation to load its recent messages. Replies, reactions, edits, deletes, stickers, attachments, and voice notes are available in the composer/message controls.
- Message edits and deletes apply only to your own messages. Group membership changes are available to group admins.
- Real-time status indicates whether Socket.IO is connected. Message history/sending uses the backend API; a Socket.IO outage alone does not disable API sends.
- Browser notifications require enabling permission in Privacy settings. Read-receipt preference and theme are saved in this browser.

## Payments and receipts

Payment history is stored by the backend when signed in. The Confirm action creates and verifies a demo transaction; no real money is sent. Signed-out demo pages use local sample data.

## Limitations

Live chat data requires a reachable MongoDB database. Uploads use local disk in development. OAuth, password-reset email, calls, and a real payment provider are not configured.

## Separate frontend/backend deployment

Deploy the backend as a persistent Node service with `PORT`, `CLIENT_URL` (the frontend's exact HTTPS origin), `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `UPLOAD_DIR`, and `NODE_ENV` set in the hosting provider's private environment configuration. Allow the backend's outbound IP in Atlas. Deploy the Vite frontend separately and supply `VITE_API_BASE_URL=https://<backend-host>/api` at build time, then rebuild/redeploy the static bundle. This URL is public configuration; never add the database URI or JWT secret to the frontend. Configure HTTPS, WebSocket upgrades, durable private uploads, backups, and shared rate limiting before production.
