# Suncatcher: Last Contact

**Team Argon · Google DeepMind AI Hackathon · October 16, 2026**

A browser-based 3D orbital repair prototype. A damaged optical relay leaves an EVA technician relying on Argon, an AI companion, to prepare a replacement reflector and reconnect the station's laser path.

## Links

- Public application: **PENDING — insert a verified public HTTPS URL**
- Demo video: **PENDING — insert an accessible video URL**
- Source repository: https://github.com/zittenyetten/suncatcher-last-contact
- Google Cloud project: `h2gdm-hack26icn-2676`

## What the prototype contains

- A Three.js station scene with first-person movement and direct reflector manipulation.
- Korean and English interfaces.
- Reflector concept previews, approval, 3D asset generation/loading, and mounting.
- Optical reflection feedback based on the reflector's yaw and pitch.
- Contextual Argon conversation, with browser speech input/output where supported.
- An orbital monitor interface and a configurable Lyria music interface.

Generated reflector geometry is displayed as a real GLB asset. Different reflector appearances currently share the same alignment rule; the prototype does not simulate a different optical performance for each generated shape.

## Status of the Last Contact mission

The intended mission is to repair the relay, transmit a rescue request during a ground-station pass, receive return clearance, and enter the airlock. The latest source includes story text, transmission UI, and backend mission fields. **A complete manual run of that new story sequence remains a submission verification item.** This draft does not claim that sequence has passed end-to-end testing.

The core reflector preparation and alignment flow is distinct from that pending story verification. Automated demonstration mode is available in the code; it should be identified as a demonstration, not recorded as manual play.

## AI and technology disclosure

| Component | Implementation and evidence boundary |
| --- | --- |
| Runtime Argon conversation | The server invokes the authenticated `agy` CLI, configured in code with `gemini-3.8-flash-low`. Responses are plain text; the browser handles speech recognition and speech synthesis. A configured API key does not itself verify a Gemini Live API session. |
| Reflector generation | A server pipeline requests Three.js geometry code, validates it, and exports a GLB. Fast demonstration mode loads previously generated, verified geometry assets instead of performing a fresh model call. |
| Design previews | Included concept assets have local provenance labels identifying Antigravity image generation / Nano Banana. The default preview path can reuse those assets; arbitrary live image editing is not implied. |
| Music | The source includes Lyria generation UI and a server API route for `lyria-3-clip-preview` / `lyria-3.5`. Fresh generation requires a working server-side key and endpoint access. Existing music playback and a successful fresh generation are separate claims. |
| Development and assets | Antigravity-assisted development and previously generated assets are part of the development workflow. They should be distinguished from calls made while a judge plays. |
| Game and server | Three.js, Node.js, Fastify, JavaScript modules, GLB assets. |

Model identifiers above describe the current configuration and local provenance, not an independent certification of model availability.

## Run locally

From the repository root:

```powershell
npm install
npm start
```

Open `http://127.0.0.1:59012/`. The server reads `PORT` and `HOST`; its current defaults are port `59012` and host `0.0.0.0`.

The existing assets must be included in `artifacts/` and `public/audio/`. Live dialogue and normal 3D generation depend on the workstation's authenticated `agy` CLI. Lyria generation requires a server-side `GEMINI_API_KEY`. Do not commit keys, authentication files, or `.env` files.

Local workstation authentication is not automatically available in a cloud container. The submitted public build must be tested independently, including the exact AI actions advertised to judges.

## Controls

- Left-drag: look around.
- WASD / arrow keys: move; Space: jump; C: center the view.
- E or the mounting control: mount a prepared reflector.
- Right-drag, sliders, or Q/R and F/G: adjust reflector yaw/pitch.
- V or the voice control: talk to Argon where browser speech recognition is supported.
- Use the language control to switch to English.

## Verification

The repository provides `npm test`, `npm run verify:3d`, and `npm run verify:e2e`. These commands were **not rerun while preparing this submission draft**. Some verification paths can generate assets or call external services. Older verification results should not be treated as proof of the latest story flow or public deployment.

Before submission, complete a manual run on the exact submitted build and verify the public application, repository, and video links from an unauthenticated browser.

## Current boundaries

- The orbital panel can fetch external orbital data and uses simplified local propagation. It is not a precision real-time tracking service; gameplay communication windows are not claimed to be physically accurate predictions.
- Generated appearance is not a physically evaluated reflector design.
- Speech support and microphone access depend on the browser.
- Pass-window transmission, ground clearance, and return footage must be verified before being presented as completed gameplay.

