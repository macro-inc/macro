# call_recording_preview_handler

## What it is

Calls feature: S3-triggered Lambda that generates a JPEG preview thumbnail
for a call recording MP4, using ffmpeg/ffprobe.

## Start here

- `src/event.rs`: the S3 event handler — decides whether to process, probes
  duration, extracts a midpoint frame, uploads the preview.
- `src/key.rs`: pure key-decision logic (`KeyDecision`/`SkipReason`) for which
  S3 keys are eligible — read this before changing what counts as "a call
  recording".
- `src/ffmpeg.rs`: `FfmpegTools` wrapper around the `ffmpeg`/`ffprobe`
  subprocesses, with a timeout and a frame-extraction fallback.
- `scripts/package-ffmpeg.sh`: bundles static ffmpeg/ffprobe binaries into the
  Lambda zip at build time — the binaries aren't a Cargo dependency.

## Scope

- Owns: deciding which uploaded `calls/.../*.mp4` objects need a
  `PREVIEW.jpg`, and producing it.

## Recipes

- Change which uploads get previews: `src/key.rs` → `src/key/test.rs`.
- Change frame extraction (timing, fallback, timeout): `src/ffmpeg.rs` →
  `src/ffmpeg/test.rs`.

## Checks

- `cargo test -p call_recording_preview_handler` (`SQLX_OFFLINE` unset).
- `just build` packages ffmpeg via `scripts/package-ffmpeg.sh`; a local
  `cargo build` alone won't produce a deployable zip.

## Gotchas

- `#![deny(missing_docs)]` in `src/lib.rs` — every new public item needs a doc
  comment.
