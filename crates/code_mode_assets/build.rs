//! Supplies the code-mode assets from exactly one place per build: the
//! directory in `CODE_MODE_ASSETS_DIR` when the build provides them prebuilt
//! (Nix and CI), otherwise a fresh run of `packages/code-mode-sdk`'s generator
//! into `OUT_DIR`. A failed run or a missing asset fails the build.
//!
//! The Lexical modules are a code-split set whose chunk names change with
//! their content, so this script reads `lexical-modules.tsv` and writes
//! `lexical_modules.rs`, embedding each file.

use std::env;
use std::fmt::Write as _;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
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
    write_lexical_modules(&directory);
}

/// Each manifest line is `<path>\t<specifier>`; a shared chunk has no specifier.
fn write_lexical_modules(directory: &Path) {
    let manifest = directory.join("lexical-modules.tsv");
    let listing = fs::read_to_string(&manifest)
        .unwrap_or_else(|error| panic!("could not read {}: {error}", manifest.display()));
    let mut source = String::from("&[\n");
    for line in listing.lines() {
        let (path, specifier) = line
            .split_once('\t')
            .unwrap_or_else(|| panic!("malformed line in {}: {line:?}", manifest.display()));
        let file = directory.join(path);
        assert!(
            file.is_file(),
            "{} lists missing {}",
            manifest.display(),
            file.display()
        );
        let specifier = match specifier {
            "" => "None".to_owned(),
            specifier => format!("Some({specifier:?})"),
        };
        writeln!(
            source,
            "    LexicalModule {{ path: {path:?}, specifier: {specifier}, source: include_str!({:?}) }},",
            file.display().to_string()
        )
        .expect("writing to a String cannot fail");
    }
    source.push(']');
    let output = PathBuf::from(env::var_os("OUT_DIR").expect("cargo sets OUT_DIR"));
    fs::write(output.join("lexical_modules.rs"), source).expect("write lexical_modules.rs");
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
