//! Native/WASM persisted-format and editor-projection compatibility gate.
use crate::workflows::{runners, steps, vars};
use gh_workflow::{Event, Job, Push, Step, Workflow, WorkflowCall};
use xtask_paths::RepoGlob;

pub const PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("crates/client/lexical/**"),
    xtask_paths::repo_glob!("packages/loro-mirror/**"),
    xtask_paths::repo_glob!("packages/lexical-core/markdown-loro-schema.ts"),
    xtask_paths::repo_glob!("vendor/loro-editor/**"),
    xtask_paths::repo_glob!("tooling/scripts/check-loro-editor-vendor.sh"),
    xtask_paths::repo_glob!("tooling/xtask/crates/xtask_loro_vendor/**"),
    // Any member manifest can enable the editor feature in a server graph.
    xtask_paths::repo_glob!("tooling/scripts/check-loro-native-editor-features.sh"),
    xtask_paths::repo_glob!("tooling/scripts/test-loro-servers-upstream.sh"),
    xtask_paths::repo_glob!("crates/**/Cargo.toml"),
    xtask_paths::repo_glob!("services/**/Cargo.toml"),
    xtask_paths::repo_glob!("Cargo.toml"),
    xtask_paths::repo_glob!("Cargo.lock"),
    xtask_paths::repo_glob!("package.json"),
    xtask_paths::repo_glob!("bun.lock"),
    xtask_paths::repo_glob!("services/sync-service/package-lock.json"),
    xtask_paths::repo_glob!(".github/workflows/loro-pair.yml"),
    xtask_paths::repo_glob!("tooling/xtask/crates/xtask_workflows/src/workflows/loro_pair.rs"),
];
pub fn loro_pair() -> Workflow {
    Workflow::new("loro-pair")
        .on(Event::default()
            .push(
                PATHS
                    .iter()
                    .fold(Push::default().add_branch("main"), |event, path| {
                        event.add_path(*path)
                    }),
            )
            .workflow_call(WorkflowCall::default()))
        .concurrency(vars::concurrency("loro-pair"))
        .add_job(
            "loro-pair",
            Job::default()
                .name("loro-pair")
                .timeout_minutes(45u32)
                .runs_on(runners::Runner::RustCi.with_cache_tag(vars::CI_CACHE_TAG))
                .add_step(steps::checkout(false, false))
                .add_step(steps::mount_cache_volume())
                .add_step(steps::setup_nix())
                .add_step(steps::setup_dev_shell())
                .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
                // The server gate and lexical_loro tests run Bun oracles over the workspace packages.
                .add_step(
                    Step::new("Install catalog dependencies").run("bun install --frozen-lockfile"),
                )
                // With native-editor off, the editor copy is crates.io 1.17.1.
                .add_step(
                    Step::new("Editor Loro with native-editor off matches crates.io 1.17.1")
                        .run("just check-loro-editor-vendor"),
                )
                .add_step(
                    Step::new("native-editor stays out of server dependency graphs")
                        .run("just check-loro-native-editor-features"),
                )
                // Workspace test builds run servers on the editor runtime; test them as deployed.
                .add_step(
                    Step::new("Server Loro consumers pass with native-editor off")
                        .run("just test-loro-servers-upstream"),
                )
                // With native-editor, the editor copy must still behave like crates.io 1.17.1.
                .add_step(
                    Step::new("Editor Loro with native-editor matches crates.io 1.17.1")
                        .run("just test-loro-editor-differential"),
                )
                .add_step(
                    Step::new("Native projection and catalog Loro compatibility")
                        .run("PROPTEST_CASES=64 cargo test --locked -p lexical_loro -j4"),
                )
                .add_step(steps::teardown_nix()),
        )
}
