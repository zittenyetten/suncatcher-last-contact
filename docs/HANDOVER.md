# Suncatcher: Last Contact — development handover

Team Argon. Prepared October 16, 2026, while the original project was still being edited. This document describes the inspected source snapshot, not a certification that every feature works on the deployed revision.

The user confirmed that the temporary DeepMind account and event Google Cloud project will be irreversibly deleted after the event, before 17:00 KST on October 16, 2026. The existing application URL is an event link expected to expire. Continuation is **local only**: the user explicitly requested no deployment to a personal cloud account.

- Application: https://argon-suncatcher-1018540534.asia-northeast3.run.app/
- Repository: https://github.com/zittenyetten/suncatcher-last-contact
- Demo video: https://drive.google.com/file/d/1kTdhL3qB1Z2sIj1qfCBg2vaB4efmS1KA/view?usp=sharing

## Which folder to use

- `C:\Codex\Projects\argon-suncatcher` is the original active Antigravity workspace. At inspection it was **not a Git repository**; edits there do not automatically reach GitHub.
- `C:\Codex\Projects\suncatcher-last-contact-publish` is the Git checkout used for publication. It contains a curated source/asset snapshot, with credentials and internal QA output excluded.

Finish or stop the current editing task before reconciling the folders. Review any changes made after the publication snapshot. For future development, open the publication checkout in Antigravity under the new account, or clone the repository into a new folder. Keep one active source of truth. Start by reading this file and the README, running `git status`, and creating a work branch such as `codex/continue-suncatcher`. Do not overwrite either folder blindly. Git commits and Cloud Run deployments are separate operations.

## What the inspected code implements

- A Three.js orbital repair scene, direct mouse/keyboard controls, English/Korean UI, and a reflector approval/load/mount/alignment loop.
- Optical reflection calculated from reflector yaw/pitch, with a 2.8-degree receiver lock threshold. The inspected implementation restores communications and opens the gate immediately on alignment.
- Two included reflector preview families and two verified GLB assets. Production/Linux uses these existing assets; this is not arbitrary fresh 3D generation during every play session. The default preview path also reuses existing images.
- An interactive Earth/Moon/Sun monitor and solar-system view. The inspected frontend advances a local simulation; do not describe it as verified live satellite tracking.
- Argon dialogue attempts Gemini REST, then an available Windows Antigravity CLI, then fixed mission guidance. Browser speech input/output is optional and browser dependent.
- Three saved Lyria tracks and a playlist, plus an optional server-side REST generation route. Saved playback does not prove fresh generation access.

## Critical remaining issues and focused checks

### 1. Last Contact story references are incomplete

Rechecked original `public/game.js` at 177,887 bytes, last modified 16:08 KST. SHA-256: `c40daa5ad10c7ea670faf145e31e1e53d1e68c0adbfb8d4f4e95e02b39c2d05b`.

The file calls `triggerStoryLine`, `getAlignmentDirectionHint`, and `normalizePosAngle`, and references `PASS_CONFIG`, without defining them. Replay calls `gameState.triggeredStoryKeys.clear()` without initializing that set. Transmission progress is reset but has no advancement loop. The completion condition currently checks optical alignment/comms/gate state rather than successful transmission and return.

Reproduce on a local build: approve/load a reflector, click Mount, then inspect browser errors; try alignment assistance and mission restart. Mount invokes the missing story function, assistance invokes the missing hint function, and restart reaches the missing set. Pass-window actions also reference missing symbols. Ordinary JavaScript syntax checks do not catch these errors.

Next action: restore and test one consistent story state machine, including transmission pause/resume, ground acknowledgement, airlock permission, and return. Until then, describe the working optical-repair loop without claiming the full rescue sequence is complete. Recheck against newer source before fixing; editing was ongoing.

### 2. Initial anonymous sessions can collide

`server/app.mjs` falls back to a session ID derived from the request IP when there is no session header/cookie. The frontend's initial request has no session ID. Separate visitors behind one IP/proxy can therefore share state. Explicit distinct session headers do isolate state.

Local reproduction, using separate requests without a cookie jar:

```powershell
$base = 'http://127.0.0.1:59013'
$first = Invoke-RestMethod "$base/api/state"
Invoke-RestMethod "$base/api/lang" -Method Post -ContentType 'application/json' -Body '{"lang":"ko"}'
$second = Invoke-RestMethod "$base/api/state"
$first.sessionId -eq $second.sessionId
$second.lang
```

Observed result in an isolated Fastify check: `True`, then `ko`. Generate a random session ID for a new visitor instead of using IP as identity. Then test two independent browser contexts. Session state is currently in memory and is not durable across instance restarts or reliably shared across multiple Cloud Run instances.

### 3. Keyless unit-test validation differs from its expectation

`generateLyriaMusic` checks credentials before validating an empty prompt. Without a key, the empty-prompt test receives HTTP 500 rather than the expected 400. Decide and test the intended validation order. Do not supply a real key merely to make this offline validation test pass.

## Reliable local startup

Use Node.js 22 or a compatible supported version. From the repository checkout:

```powershell
Set-Location 'C:\Codex\Projects\suncatcher-last-contact-publish'
npm.cmd ci
$env:PORT = '59013'
$env:HOST = '127.0.0.1'
$env:NODE_ENV = 'production'
npm.cmd start
```

Open http://127.0.0.1:59013/. Port 59013 avoids the original development server on 59012. Keep `artifacts/designs`, the two baseline model families, and the playlist's audio files with the source. Production mode selects verified model assets; it does not disable optional dialogue/music requests.

`server/index.mjs` reads `PORT` and `HOST` **before** `createApp()` loads `.env`, so set those variables in the launching shell or deployment configuration. Do not rely on `.env` for the listening address. The default port is 59012. An existing `GEMINI_API_KEY` can also cause the current environment loader to skip reading `.env` entirely.

Leave credentials out of Git. Use personal server-side API access only after confirming model/endpoint access and billing. Core saved assets remain available without new AI generation. Do not enable `ENABLE_UNSAFE_3D_EVAL` on a public server: the development evaluation path executes generated JavaScript in the server process.

## Verification evidence

- Syntax checks passed for the inspected game, app, AI service, and model-generator modules. This does not establish runtime correctness.
- Existing unit tests ran on an isolated copy of the latest server/tests, with no `.env` and with `fetch` blocked. Five of six child tests passed without a key; the Lyria validation test failed with `500 !== 400`. Node's aggregate reports five passes and two failures because it also counts the failed parent test.
- With a clearly fake placeholder key and the same network block, all six child tests passed (seven including the parent). This proves local validation/parser behavior only, not any AI API integration.
- `npm.cmd test` runs those tests and creates a design-preview artifact. The existing browser verification scripts require review before reuse: some can call external services, and the orbit script expects an endpoint absent from the inspected server. They do not establish completion of the new story sequence.

After changes, test the exact published revision manually: initial load, both reflector assets, mounting/angle controls, intended completion, replay, orbit monitor, two visitor sessions, and missing/failed AI credentials. Verify the deployed URL independently of localhost.

## Before the temporary account disappears

Git preserves committed source and included assets, not Antigravity conversations, credentials, Cloud IAM permissions, billing, or Drive ownership.

1. Confirm the repository is accessible from the permanent GitHub account and keep a local copy of the latest commit and required assets.
2. Save any useful development decisions or unfinished work in repository documents. Export conversations separately if needed; do not publish credentials or private session files.
3. Preserve source, generated assets, documentation, and the final video locally before the confirmed deletion deadline. Do not rely on the event Cloud Run URL, project storage, temporary IAM access, or billing configuration surviving. Do not deploy to a personal cloud account.
4. Continue with the saved assets locally. Optional future AI API use requires separately authorized credentials and model access; do not preserve temporary access tokens as the continuation strategy or add paid services automatically.
5. Keep an independent copy of the demo video and verify its Drive owner/sharing. A public link is not a backup if the owning account or file is removed.

No IAM transfer, billing change, credential replacement, or new cloud deployment is authorized or performed by this handover.
