# Publication snapshot

Snapshot began: 2026-10-16T07:21:48.863Z

This commit preserves the latest local implementation captured during active development. It is not a claim that all story features pass end-to-end tests or that the Cloud Run revision matches this Git commit. See docs/HANDOVER.md for known issues and validation.

Included: application source, package lockfile, deployment files, tests/scripts, all public runtime audio including the playlist and every referenced track, two baseline design previews, and two cached reflector code/GLB/metadata families. Generated history, QA output, local .env files, credentials, and agent state are excluded.

Packaging removes one unused personal agent path, uses a portable agy executable fallback, and makes one verification output path relative. Source and packaged hashes record these differences. The original working directory is not modified by this script.

The server serves the artifacts directory publicly. Keep only publishable assets there. Cloud and production reflector generation uses cached GLB presets; unsafe generated-code evaluation remains opt-in for local development. A denylist is not a security sandbox. No license was assigned by the packaging process.

The manifest covers the copied/generated files listed in it; separately maintained handover documents and the manifest itself are outside its hash list.
