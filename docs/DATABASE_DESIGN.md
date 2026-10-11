# MongoDB database design

Mongoose models are defined under `backend/models/`. Configure a MongoDB Atlas or local MongoDB URI using `MONGODB_URI`; no credentials or sample user/message records are committed.

## Collections

### `users`

- `name`: required, trimmed display name (registration accepts 2–80 characters).
- `email`: required, normalized lowercase, unique.
- `passwordHash`: required bcrypt hash; never returned by public profile methods.
- `avatar`, `status`, `lastSeen`, and created/updated timestamps.

### `conversations`

- `type`: `individual` or `group`.
- `members`: references to registered `User` documents.
- `name`, `image`, `lastMessage`, and `lastMessageAt`.
- `metadata.admins`, `metadata.mutedBy`, and `metadata.pinnedBy`.
- Group administration is checked by the backend; each group must retain at least one admin when a member leaves or is removed.

### `messages`

- References to `Conversation`, sending `User`, and optional replied-to message.
- `clientMessageId` for send idempotency; text/sticker type and text content.
- Optional attachment metadata (file bytes are not in MongoDB).
- Reaction counts and per-user reaction entries, `readBy`, delivery status, and timestamps.
- Text length is limited to 5,000 characters by the HTTP API.

### `transactions`

- Sender/recipient `User` references, amount, supported currency (`USD` only), note, reference, status, demo mode, and timestamps.
- Transaction state is created pending and changed by the authenticated server verify endpoint. Demo verification is not proof of a real transfer.

## Indexes

- Users: unique email (declared by schema).
- Conversations: members and type.
- Messages: conversation/newest-first timestamps and unique partial compound index on conversation, sender, and string client message ID.
- Transactions: sender/newest-first and a unique non-empty provider reference.

Indexes may take time to build on an existing Atlas database. Back up existing data before applying schema/index changes in production.

## Data access and files

Every conversation, group, message, and attachment operation checks the authenticated participant on the backend. Transaction reads require sender or recipient ownership. Upload bytes live on local disk under `UPLOAD_DIR`; MongoDB stores their names/type/size and the associated message/conversation. Local disk storage is for development only and needs private, durable object storage for deployment.

Without a reachable `MONGODB_URI`, health remains available and describes the degraded state; database-dependent API operations return 503. No fake records are inserted into MongoDB as fallbacks.
