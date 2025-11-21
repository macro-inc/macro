# Tauri / Mobile Frontend

This crate wraps the shared web client that lives in `packages/app`. All
platform-specific behaviour is injected via environment variables and the Vite
config variants in that package.

## Running in development

```sh
# Desktop shell (macOS/Linux/Windows)
cargo tauri dev

# iOS simulator
cargo tauri ios dev

# Android emulator
cargo tauri android dev
```

Tauri sets `TAURI_ENV_PLATFORM` before executing `beforeDevCommand`
(`bun run dev:tauri`). The scripts in `packages/app` read that variable and pick
the correct Vite config:

| `TAURI_ENV_PLATFORM` | Script invoked            | Resulting `VITE_PLATFORM` |
| -------------------- | ------------------------- | ------------------------- |
| `macos`/`windows`/`linux` (default) | `dev:desktop`     | `desktop`              |
| `ios`                | `dev:ios`           | `ios`               |
| `android`            | `dev:android`       | `android`           |

You can override the dev server host for devices/emulators by exporting
`TAURI_DEV_HOST` before running `cargo tauri …`.

## Building bundles

```sh
# Desktop bundle
cargo tauri build

# iOS / Android release artifacts
cargo tauri ios build
cargo tauri android build
```

The `beforeBuildCommand` is `bun run build:tauri`, which uses the same
`TAURI_ENV_PLATFORM` switch to pick the right Vite entrypoint and emit the
frontend into `packages/app/dist`. Tauri then packages that output according to
`tauri.conf.json`.

## Platform aware UI

The shared `@macro/tauri` package exposes helpers such as `isTauriPlatform`,
`isTauriMobilePlatform`, and `getPlatform()`. Use them anywhere you need to
branch behaviour, register extra routes, or mount native-only UI. All Solid
components still render through the same `packages/app` entry point, so keeping
platform checks inside `@macro/tauri` (or modules consuming it) keeps
conditional UI localized.
