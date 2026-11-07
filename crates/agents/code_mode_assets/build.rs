//! Supplies the code-mode assets from exactly one place per build: the
//! directory in `CODE_MODE_ASSETS_DIR` when the build provides them prebuilt
//! (Nix and CI), otherwise a fresh run of `packages/code-mode-sdk`'s generator
//! into `OUT_DIR`. A failed run or a missing asset fails the build.

use std::env;
use std::io;
use std::path::PathBuf;
use std::process::{Command, Stdio};

const PREBUILT: &str = "CODE_MODE_ASSETS_DIR";

const GENERATOR: &str = "packages/code-mode-sdk/scripts/generate.ts";

/// Everything the generator reads, relative to the repository root. TypeDoc
/// compiles every file `packages/sdk/tsconfig.json` includes, and the SDK's
/// declarations are emitted with `tsconfig.build.json`.
const GENERATOR_INPUTS: [&str; 18] = [
    "bun.lock",
    "package.json",
    "packages/code-mode-sdk/package.json",
    "packages/code-mode-sdk/scripts",
    "packages/code-mode-sdk/src",
    "packages/sdk-docs/package.json",
    "packages/sdk-docs/pages",
    "packages/sdk-docs/src",
    "packages/sdk/bun.lock",
    "packages/sdk/generated",
    "packages/sdk/openapi-ts.config.ts",
    "packages/sdk/package.json",
    "packages/sdk/scripts",
    "packages/sdk/services.ts",
    "packages/sdk/src",
    "packages/sdk/tests",
    "packages/sdk/tsconfig.build.json",
    "packages/sdk/tsconfig.json",
];

fn main() {
    println!("cargo::rerun-if-env-changed={PREBUILT}");

    let directory = match env::var_os(PREBUILT) {
        Some(directory) => PathBuf::from(directory),
        None => generate(),
    };

    // `include_str!` resolves a relative path against `src/`, not the caller.
    assert!(
        directory.is_absolute(),
        "{PREBUILT} must be an absolute path, got {}",
        directory.display()
    );

    println!("cargo::rustc-env=CODE_MODE_ASSETS={}", directory.display());
}

fn generate() -> PathBuf {
    let manifest =
        PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR"));
    let root = manifest.join("../../..");
    let output = PathBuf::from(env::var_os("OUT_DIR").expect("cargo sets OUT_DIR"));

    for input in GENERATOR_INPUTS {
        println!("cargo::rerun-if-changed={}", root.join(input).display());
    }

    // Cargo reads build script stdout as directives, so the generator logs to stderr.
    let status = Command::new("bun")
        .arg(GENERATOR)
        .arg(&output)
        .current_dir(&root)
        .stdout(Stdio::from(io::stderr()))
        .status();

    match status {
        Ok(status) if status.success() => output,
        Ok(status) => panic!(
            "{GENERATOR} failed ({status}). Run `bun install --frozen-lockfile` at the repository \
             root and in packages/sdk, or point {PREBUILT} at `nix build .#code-mode-assets`."
        ),
        Err(error) => panic!(
            "could not run bun for {GENERATOR}: {error}. Bun is in the nix devshell; \
             or point {PREBUILT} at `nix build .#code-mode-assets`."
        ),
    }
}
