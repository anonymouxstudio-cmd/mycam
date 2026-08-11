# Anonymoux Studio — Realtime Video Editor

A working frontend + backend for realtime, prompt-driven camera
editing using [fal.ai](https://fal.ai)'s `decart/lucy-2-5/realtime`
model (Decart's Lucy 2.5).

## What changed from the mockup

The original file was a static UI with a `fetch("/api/lucy/realtime")`
call to a backend that didn't exist. This version:

- Adds a real Node/Express backend (`server.js`) implementing fal.ai's
  documented **server-side proxy**, so your `FAL_KEY` never reaches
  the browser. (https://fal.ai/docs/documentation/model-apis/inference/proxy-setup)
- Swaps the placeholder fetch call for fal's actual `@fal-ai/client`
  SDK (`fal.realtime.connect`) talking to `decart/lucy-2-5/realtime`.
- Implements real WebRTC negotiation (offer/answer/ICE) against the
  model's documented output schema (`sdp`, `type`, `iceServers`,
  `candidate`). (https://fal.ai/models/decart/lucy-2-5/realtime/api)

## Setup

```bash
cd anonymoux-studio
npm install
cp .env.example .env      # then edit .env and add your FAL_KEY
export FAL_KEY=$(grep FAL_KEY .env | cut -d= -f2)
npm start
```

Open http://localhost:3000, allow camera access, enter a prompt, and
click **Apply edit**.

Get an API key at https://fal.ai/dashboard/keys — new accounts get
free trial credits.

## Notes / things worth knowing

- **Cost**: Lucy realtime billing is metered per second of streaming
  (check current pricing on fal.ai before leaving a session open).
- **Reference images**: the "reference image" field is meant for
  style/outfit references or a photo of *yourself* for a self-styling
  filter — not for placing a real person's likeness onto someone
  else's live video without their consent. Consider adding your own
  consent/verification gate in front of this feature if you deploy it
  beyond personal testing (e.g. requiring the uploader to be the
  person on camera).
- The proxy in `server.js` allowlists only the Decart Lucy endpoints
  by default (`ALLOWED_ENDPOINTS`). Extend that list if you wire up
  other fal models.
- WebRTC/signaling details for realtime video models can evolve —
  if `onResult` payload shapes change, check
  https://fal.ai/models/decart/lucy-2-5/realtime/api for the current
  schema.
