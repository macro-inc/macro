//! Compiles the native host's engine module (`apps/web/tauri/graphql_cache_plugin/src/engine*`)
//! into this binary without the Tauri plugin around it, so the fuzzer drives the same
//! `EngineHandle` the desktop app does, from whichever checkout it is built in.

use std::path::{Path, PathBuf};

fn main() {
    let manifest = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let host = manifest.join("../../../apps/web/tauri/graphql_cache_plugin/src");
    let out = PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("host");
    std::fs::create_dir_all(out.join("engine")).unwrap();
    let engine = read(&host.join("engine.rs"));
    // The plugin's own tests stay out; the fuzzer's hooks take their place.
    let engine = engine.replace("#[cfg(test)]\nmod test;", "") + "\npub(crate) mod fuzz_hooks;\n";
    // As a `mod.rs`, so its submodules resolve next to it.
    std::fs::write(out.join("engine/mod.rs"), engine).unwrap();
    // Every submodule but the tests, so a build of any checkout gets the ones it declares.
    for entry in std::fs::read_dir(host.join("engine")).unwrap() {
        let source = entry.unwrap().path();
        let name = source.file_name().unwrap().to_owned();
        if source.extension().is_none_or(|extension| extension != "rs") || name == "test.rs" {
            continue;
        }
        // Outside Tauri, the host's background tasks run on the fuzzer's Tokio runtime,
        // which is what Tauri's async runtime is.
        let module = read(&source).replace("tauri::async_runtime::spawn(", "tokio::spawn(");
        std::fs::write(out.join("engine").join(name), module).unwrap();
    }
    // Hosts whose `soup::write_projections` takes the write's normalized
    // updates get `cfg(write_projections_normalized)`, so the hooks build
    // against hosts from before and after that parameter.
    println!("cargo::rustc-check-cfg=cfg(write_projections_normalized)");
    let soup = read(&host.join("engine/soup.rs"));
    let normalized = soup
        .split_once("fn write_projections(")
        .and_then(|(_, rest)| rest.split_once(") ->"))
        .is_some_and(|(parameters, _)| parameters.contains("normalized:"));
    if normalized {
        println!("cargo::rustc-cfg=write_projections_normalized");
    }
    // Hosts whose reads can be abandoned by request id (`EngineHandle::abandonable`)
    // get `cfg(abandon_reads)`, so `--abandon-reads` abandons them.
    println!("cargo::rustc-check-cfg=cfg(abandon_reads)");
    if read(&host.join("engine/authority.rs")).contains("pub fn abandonable(") {
        println!("cargo::rustc-cfg=abandon_reads");
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
    // A side whose cache core stages hydrates (`Engine::stage_hydrate`) is built with
    // CACHE_DIFF_FUZZ_STAGED_HYDRATE=1, so `--stage-hydrates` can stage one ahead of an op.
    println!("cargo::rustc-check-cfg=cfg(staged_hydrate)");
    println!("cargo:rerun-if-env-changed=CACHE_DIFF_FUZZ_STAGED_HYDRATE");
    if std::env::var_os("CACHE_DIFF_FUZZ_STAGED_HYDRATE").is_some_and(|value| value == "1") {
        println!("cargo::rustc-cfg=staged_hydrate");
    }
    // A side whose storage can stop a migration after a given step
    // (`cache_turso::migration_test_hooks`) is built with CACHE_DIFF_FUZZ_MIGRATION_HOOKS=1
    // and that crate's `migration-test-hooks` feature, so `--interrupt-migration-after` can.
    println!("cargo::rustc-check-cfg=cfg(migration_hooks)");
    println!("cargo:rerun-if-env-changed=CACHE_DIFF_FUZZ_MIGRATION_HOOKS");
    if std::env::var_os("CACHE_DIFF_FUZZ_MIGRATION_HOOKS").is_some_and(|value| value == "1") {
        println!("cargo::rustc-cfg=migration_hooks");
    }
}

fn read(path: &Path) -> String {
    println!("cargo:rerun-if-changed={}", path.display());
    std::fs::read_to_string(path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}
