# HistoNote

Voice-first reporting for histopathologists. A pathologist records a natural dictation, HistoNote stores the recording, transcribes it, turns only explicitly supported statements into structured fields, flags missing or uncertain information, and produces an editable draft report.

## V1 workflow

1. Create a private pathologist account with Convex-native authentication.
2. Start a GI biopsy or breast core biopsy case.
3. Record continuously. Recording stops only when the user stops it or three minutes of uninterrupted silence are detected.
4. The recording uploads directly to Convex storage.
5. A Convex action sends the recording to OpenAI speech-to-text and sends the transcript through a strict structured-output schema.
6. The pathologist reviews the transcript, structured fields, source evidence, uncertainties, missing items, and final editable report.

## Architecture

- **Next.js 16 static export** — product UI with no server-rendered pages, server actions, or API routes.
- **Convex static hosting** — serves the exported frontend and its client-side routes from the deployment's `.convex.site` domain.
- **Convex backend** — users, 12-hour sessions, cases, assets, file storage, queries, mutations, and server-side OpenAI actions.
- **Convex-native sign-in** — credential login with the existing bcrypt password hashes and per-user session tokens.
- **OpenAI** — `gpt-4o-mini-transcribe` for speech-to-text and `gpt-5-mini` with Structured Outputs for report drafting.

The browser never supplies a trusted user ID. Every protected Convex function resolves ownership from the signed session and checks case ownership. OpenAI credentials stay in Convex environment variables and are only read by Convex actions.

## Local setup

```bash
npm install
npx convex dev --once
npm run setup:env
npm run dev
```

`npm run setup:env` configures the OpenAI model names on the current Convex development deployment and reuses `OPENAI_API_KEY` from the current shell when available. `.env.local` is ignored by Git.

Required environment variables are documented in `.env.example`.

## Deployment

```bash
npm run deploy
```

The deploy command builds the Next.js static export, deploys the Convex backend, uploads the exported files, and publishes the site on Convex static hosting.

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
