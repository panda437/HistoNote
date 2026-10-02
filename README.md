# HistoNote

Voice-first reporting for histopathologists. A pathologist records a natural dictation, HistoNote stores the recording, transcribes it, turns only explicitly supported statements into structured fields, flags missing or uncertain information, and produces an editable draft report.

## V1 workflow

1. Create a private pathologist account with Auth.js / NextAuth.
2. Start a GI biopsy or breast core biopsy case.
3. Record continuously. Recording stops only when the user stops it or three minutes of uninterrupted silence are detected.
4. The recording uploads directly to Convex storage, avoiding Vercel request-size limits.
5. A Convex action sends the recording to OpenAI speech-to-text and sends the transcript through a strict structured-output schema.
6. The pathologist reviews the transcript, structured fields, source evidence, uncertainties, missing items, and final editable report.

## Architecture

- **Next.js 16 + Vercel** — product UI, Auth.js session boundary, and authenticated API routes.
- **Convex** — users, cases, assets, file storage, real-time-ready backend, and server-side OpenAI actions.
- **Auth.js / NextAuth** — credential login with bcrypt-hashed passwords and 12-hour JWT sessions.
- **OpenAI** — `gpt-4o-mini-transcribe` for speech-to-text and `gpt-5-mini` with Structured Outputs for report drafting.

The browser never supplies a trusted user ID. Every API route derives ownership from the signed session, and every Convex function also requires a server-only service secret and checks case ownership.

## Local setup

```bash
npm install
npx convex dev --once
npm run setup:env
npm run dev
```

`npm run setup:env` creates local Auth.js and service secrets, sends the service secret to the current Convex development deployment, and reuses `OPENAI_API_KEY` from the current shell when available. `.env.local` is ignored by Git.

Required environment variables are documented in `.env.example`.

## Verification

```bash
npm run typecheck
npm run lint
npm run build
npx convex dev --once
```

## Safety boundary

HistoNote is a drafting aid, not a diagnostic system. The extraction prompt and schema are designed to leave unsupported fields blank and require verbatim transcript evidence for populated clinical fields. Every generated report still requires review and sign-out by a qualified pathologist.

This V1 has not been certified for HIPAA or any equivalent health-data regulation. Do not enter identifiable patient information until the deployment has completed an appropriate security, privacy, retention, audit, contractual, and regulatory review.
