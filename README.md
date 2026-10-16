# Suncatcher: Last Contact

**Team Argon — Google DeepMind AI Hackathon, October 16, 2026**

A browser-based 3D orbital repair prototype. Help Argon prepare and mount a replacement reflector, then reconnect a damaged station's laser path through manual beam alignment.

## Project links

- [Google Cloud demo — temporary event deployment](https://argon-suncatcher-1018540534.asia-northeast3.run.app/)
- [Demo video — Google Drive](https://drive.google.com/file/d/1kTdhL3qB1Z2sIj1qfCBg2vaB4efmS1KA/view?usp=sharing)
- [Source repository](https://github.com/zittenyetten/suncatcher-last-contact)

The event account and Google Cloud project are scheduled for deletion after the event, according to the organizer notice relayed by the project owner. The hosted URL will not be a permanent demo. No deployment to a personal Cloud project is planned or authorized. Continue locally using this repository and the recorded demo.

## Implemented core

- Three.js orbital scene, English/Korean UI, and direct reflector manipulation.
- Reflector design previews, approval, GLB loading, mounting, and yaw/pitch controls.
- Visible incident/reflected beams with optical alignment feedback.
- An interactive Earth/Moon/Sun monitor and solar-system view using a local orbital simulation.
- Argon text assistance, optional browser speech input/output, and saved Lyria music playback.

The current source has incomplete Last Contact story hooks. Do not treat the communication window, rescue transmission, and return sequence as a completed end-to-end mission. The handover documents the missing runtime references, anonymous-session collision, and a keyless validation failure. These are preserved as development work, not silently declared fixed.

## AI implementation

| Component | Current behavior |
| --- | --- |
| Argon dialogue | Attempts a server-side Gemini REST request, then an available Windows Antigravity CLI, then fixed mission guidance. Fresh AI responses require valid service access. |
| Reflector assets | Production/Linux and the default safe path load included verified GLB presets. Optional Windows development generation uses the CLI and is disabled unless explicitly enabled. |
| Design previews | Existing generated concept images are included. Reusing one is not a fresh image-generation call. |
| Music | Included Lyria-generated tracks and playlist; optional server-side fresh generation requires a valid API key and model access. |
| Development | Antigravity-assisted development and generated assets are distinct from runtime AI calls. |

Model strings and stored provenance describe configuration, not independently verified future model availability. The game does not evaluate a generated reflector shape as an engineering-grade optical design.

## Continue locally

Use Node.js 22 or a compatible supported version. From this checkout:

```powershell
npm.cmd ci
$env:PORT = '59013'
$env:HOST = '127.0.0.1'
$env:NODE_ENV = 'production'
npm.cmd start
```

Open http://127.0.0.1:59013/. The alternate port avoids the original development server on 59012. Production mode selects cached reflector assets. Optional dialogue/music actions may still attempt external services; do not supply a key unless you intend to use those services.

The source loads `.env` for optional credentials. `PORT` and `HOST` are read before that loader runs, so set them in the launching shell. `.env.example` contains placeholders only. Never commit real API keys, credentials, agent sessions, or service-account files.

Keep the supplied `artifacts/designs`, baseline model families, and `public/audio` files with the application. The video demonstrates an edited local run, with pre-generated preparation labeled. It does not prove the unfinished story sequence or the current Cloud revision works end to end.

## Development status and verification

See [development handover](docs/HANDOVER.md) for the exact source snapshot, reproduction steps, folder roles, and next tasks. The original Antigravity folder is separate from this Git checkout; edits there do not automatically update this repository.

Syntax checks pass for the inspected modules. Offline unit checks pass five of six child tests without a key; the remaining test receives 500 rather than the expected 400 for an empty music prompt. With a non-real placeholder key and all fetch calls blocked, all six child tests pass. This is validation evidence, not a live AI integration test.

`npm.cmd test` runs the current unit tests. Browser verification scripts need review before reuse; some are stale and some can invoke AI services. Do not enable unsafe generated-code evaluation on a public server. The artifact folder is publicly served, so keep private QA output elsewhere.

- [Submission description](docs/SUBMISSION.txt)
- [Account and asset continuity](docs/ACCOUNT-CONTINUITY.txt)
- [Publication snapshot notes](PACKAGE-NOTES.md)

No new Cloud deployment, account transfer, billing change, or credential replacement is included in this source update.
