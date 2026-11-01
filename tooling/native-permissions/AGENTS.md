# native-permissions

## What it is

A check that the native bundles keep the camera and microphone permissions that
meetings and dictation need: the usage strings in the macOS
(`desktop-cef/tauri.conf.json`) and iOS Info.plists, and the macOS entitlements.
Without them, WebKit and Chromium never expose `navigator.mediaDevices`.

## Scope

- Owns: the native media permission check.
- Not here: the web browser floor. That's `apps/web/package.json` `browserslist`
  (also the esbuild target in `apps/web/vite.base.ts`) and the ast-grep rules
  `ts-browser-floor-apis` and `tsx-browser-floor-apis`. Signed-DMG validation:
  `tooling/xtask/crates/xtask_workflows/src/workflows/scripts/validate_signed_dmg.sh`.

## Checks

- `bun test tooling/native-permissions && bun tooling/native-permissions/check.ts`
  from the repository root. CI runs it in Web App Check, and `just check` runs
  it when the Tauri plists or configs change.

## Gotchas

- No `package.json`: it uses only Bun and Node built-ins, so nothing needs to be
  installed.
