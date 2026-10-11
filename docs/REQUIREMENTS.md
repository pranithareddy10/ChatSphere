# Requirements

## Implemented functional requirements

- Account registration/login and authenticated profile update
- Authenticated conversation directory, persistent history, replies, reactions, editing/deletion, and read receipts
- Authenticated real-time delivery and typing with server-side room membership checks
- Group creation and admin-only member management
- Image/document uploads and browser voice-note recording
- Emoji/sticker reactions and composer controls
- Browser notifications and local theme/privacy preferences
- Persisted demo payments, history, and receipts (no real money transfer)

## Non-functional requirements

- Preserve existing frontend design and demo mode.
- Validate authenticated access to conversation, group, and attachment data.
- Keep secrets in local environment configuration.
- Provide empty/loading/error/offline UI states.
- Avoid implying unsupported external providers are configured.

## Configuration-dependent requirements

- Live persistence and multi-user verification require a valid `MONGODB_URI`.
- Production uploads require durable private object storage.
- OAuth, email password reset, calling, and real payment processing require separate provider setup.
- Cross-device privacy settings are not persisted server-side.
