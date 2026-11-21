//! Compiles the native host's engine module (`apps/web/tauri/graphql_cache_plugin/src/engine*`)
//! into this binary without the Tauri plugin around it, so the fuzzer drives the same
//! `EngineHandle` the desktop app does, from whichever checkout it is built in.

use std::path::{Path, PathBuf};

const MODULES: &[&str] = &["access", "authority", "calendar", "people", "soup"];

fn main() {
    let manifest = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let host = manifest.join("../../../apps/web/tauri/graphql_cache_plugin/src");
    let out = PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("host");
    std::fs::create_dir_all(out.join("engine")).unwrap();
    let engine = read(&host.join("engine.rs"));
    // The plugin's own tests stay out; the fuzzer's hooks take their place.
    let engine = engine.replace("#[cfg(test)]\nmod test;", "") + "\nmod fuzz_hooks;\n";
    // As a `mod.rs`, so its submodules resolve next to it.
    std::fs::write(out.join("engine/mod.rs"), engine).unwrap();
    for module in MODULES {
        let source = host.join("engine").join(format!("{module}.rs"));
        std::fs::write(
            out.join("engine").join(format!("{module}.rs")),
            read(&source),
        )
        .unwrap();
    }
    let hooks = manifest.join("src/fuzz_hooks.rs");
    std::fs::write(out.join("engine/fuzz_hooks.rs"), read(&hooks)).unwrap();
    std::fs::write(
        out.join("mod.rs"),
        format!(
            "#[path = {:?}]\n#[allow(dead_code, unused_imports, clippy::all)]\npub mod engine;\n",
            out.join("engine/mod.rs")
        ),
    )
    .unwrap();
    println!("cargo:rerun-if-changed={}", host.display());
    println!("cargo:rerun-if-changed={}", hooks.display());
    // A side whose engine host checkpoints the WAL when idle (`TursoStorage::checkpoint_if_due`)
    // is built with CACHE_DIFF_FUZZ_IDLE_CHECKPOINT=1, so the fuzzer calls it at `idle` ops. A
    // cfg rather than a feature: `--all-features` must still build against a cache without it.
    println!("cargo::rustc-check-cfg=cfg(idle_checkpoint)");
    println!("cargo:rerun-if-env-changed=CACHE_DIFF_FUZZ_IDLE_CHECKPOINT");
    if std::env::var_os("CACHE_DIFF_FUZZ_IDLE_CHECKPOINT").is_some_and(|value| value == "1") {
        println!("cargo::rustc-cfg=idle_checkpoint");
    }
}

fn read(path: &Path) -> String {
    println!("cargo:rerun-if-changed={}", path.display());
    std::fs::read_to_string(path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}
