# Source candidate notes

Project: Suncatcher: Last Contact
Team: Argon
Snapshot began: 2026-10-16T06:20:28.990Z

This is a preparation snapshot while implementation is still being edited. Files were copied individually, not captured as an atomic Git commit. Refresh and validate the source after implementation is complete. No original application files were changed by this packaging script.

## Included

Application source, package manifests, Dockerfile, scripts/tests, public runtime audio, two baseline preview images, and two cached reflector code/GLB pairs. The primary cached model metadata is included for the existing verification script. The duplicate timestamped audio file, generated image/model history, screenshots, QA fixtures, local logs, personal agent metadata, node_modules, Git data, and all real environment files are excluded.

## Candidate-only changes

The unused personal Antigravity brain path was removed. The CLI executable defaults to agy instead of a personal Windows path. One verification script uses a checkout-relative output path. Ignore files and safe environment placeholders were generated for this package. Source and packaged hashes are recorded per file.

## Before public deployment

- The live dialogue and non-cached model generation paths require an authenticated Antigravity CLI. The Dockerfile does not install or authenticate it.
- Generated JavaScript executes in the server process via new Function after a denylist check. That is not a security sandbox. Do not present this as safe untrusted-code execution.
- Application state is shared in one Fastify process rather than isolated per player.
- The entire artifacts directory is served publicly. This package includes only the curated runtime artifacts; do not later copy private QA output there.
- Some model provenance/status labels depend on configured credentials rather than a verified invocation of the named model. Verify claims before final submission.
- The project includes hackathon project identifiers in source; they are configuration identifiers, not credentials. Confirm intended project and billing configuration.
- Verify asset publication rights and select a license before claiming an open-source license. No license was invented by packaging.

This snapshot has not been deployed or used to verify a complete final mission.
