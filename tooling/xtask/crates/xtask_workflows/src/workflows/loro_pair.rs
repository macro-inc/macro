//! Native/WASM persisted-format and editor-projection compatibility gate.
use crate::workflows::{runners, steps, vars};
use gh_workflow::{Event, Job, Push, Step, Workflow, WorkflowCall};
use xtask_paths::RepoGlob;

pub const PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("crates/client/lexical/**"),
    xtask_paths::repo_glob!("packages/loro-mirror/**"),
    xtask_paths::repo_glob!("packages/lexical-core/markdown-loro-schema.ts"),
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
                .runs_on(runners::Runner::RustCi.with_cache_tag(vars::CI_CACHE_TAG))
                .add_step(steps::checkout(false, false))
                .add_step(steps::mount_cache_volume())
                .add_step(steps::setup_nix())
                .add_step(steps::setup_dev_shell())
                .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
                .add_step(
                    Step::new("Install catalog dependencies").run("bun install --frozen-lockfile"),
                )
                .add_step(
                    Step::new("Native projection and catalog Loro compatibility")
                        .run("PROPTEST_CASES=64 cargo test --locked -p lexical_loro -j4"),
                )
                .add_step(steps::teardown_nix()),
        )
}
