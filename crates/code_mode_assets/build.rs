//! Supplies the code-mode assets from exactly one place per build: the
//! directory in `CODE_MODE_ASSETS_DIR` when the build provides them prebuilt
//! (Nix and CI), otherwise a fresh run of `packages/code-mode-sdk`'s generator
//! into `OUT_DIR`. A failed run or a missing asset fails the build. CI may still
//! be building the directory when this runs; then it waits (see [`READY`]).

use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const PREBUILT: &str = "CODE_MODE_ASSETS_DIR";

/// Set by CI while it builds `CODE_MODE_ASSETS_DIR` alongside cargo: a file that
/// appears holding `ok`, or the end of the build's log when it failed. Not a
/// rerun trigger: the directory alone decides what this crate embeds.
const READY: &str = "CODE_MODE_ASSETS_READY";

/// Over three times the slowest build seen in CI, and under the jobs' own
/// timeouts, so a build that hangs fails here with its log.
const READY_TIMEOUT: Duration = Duration::from_secs(10 * 60);

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

    if let Some(status) = env::var_os(READY) {
        wait_until_built(Path::new(&status));
    }

    println!("cargo::rustc-env=CODE_MODE_ASSETS={}", directory.display());
}

fn wait_until_built(status: &Path) {
    let deadline = Instant::now() + READY_TIMEOUT;
    loop {
        match fs::read_to_string(status) {
            Ok(text) if text.trim() == "ok" => return,
            Ok(text) => panic!("the code-mode assets did not build:\n{text}"),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                if Instant::now() >= deadline {
                    let log = status.with_extension("log");
                    let text = fs::read_to_string(&log).unwrap_or_default();
                    let tail = text.lines().rev().take(60).collect::<Vec<_>>();
                    panic!(
                        "the code-mode assets were not built within {READY_TIMEOUT:?}; \
                         the end of {}:\n{}",
                        log.display(),
                        tail.into_iter().rev().collect::<Vec<_>>().join("\n")
                    );
                }
                thread::sleep(Duration::from_millis(500));
            }
            Err(error) => panic!("could not read {}: {error}", status.display()),
        }
    }
}

fn generate() -> PathBuf {
    let manifest =
        PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR"));
    let root = manifest.join("../..");
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
