//! Path-filtered native replay, traceability, recorder and wasm validation.
use crate::workflows::{runners, steps, vars};
use gh_workflow::{Event, Expression, Job, Level, Permissions, Step, Workflow, WorkflowCall};
use xtask_paths::RepoGlob;

/// Paths that require the Lexical conformance checks.
pub const PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("crates/client/lexical/**"),
    xtask_paths::repo_glob!("packages/lexical-wasm-shim/**"),
    xtask_paths::repo_glob!("packages/lexical-conformance/**"),
    xtask_paths::repo_glob!("packages/lexical-core/**"),
    xtask_paths::repo_glob!("packages/loro-mirror/**"),
    xtask_paths::repo_glob!("static_assets/markdown-golden.1.bin"),
    xtask_paths::repo_glob!("crates/slack_integration/tests/fixtures/native-message-links.json"),
    xtask_paths::repo_glob!("apps/web/src/lib/core/component/LexicalMarkdown/**"),
    xtask_paths::repo_glob!("apps/web/patches/@lexical*"),
    xtask_paths::repo_glob!("services/lexical-service/**"),
    xtask_paths::repo_glob!("docs/design/lexical-port/**"),
    xtask_paths::repo_glob!("tooling/xtask/crates/xtask_workflows/**"),
    xtask_paths::repo_glob!(".github/workflows/lexical_*.yml"),
    xtask_paths::repo_glob!("vendor/**"),
    xtask_paths::repo_glob!(".cargo/**"),
    xtask_paths::repo_glob!("rust-toolchain.toml"),
    xtask_paths::repo_glob!("Cargo.toml"),
    xtask_paths::repo_glob!("Cargo.lock"),
    xtask_paths::repo_glob!("justfile"),
    xtask_paths::repo_glob!("flake.nix"),
    xtask_paths::repo_glob!("flake.lock"),
];
/// Session changes have their own independent PR path filter.
pub const SESSION_PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("crates/client/doc_sync_core/**"),
    xtask_paths::repo_glob!("crates/client/document_session*/**"),
    xtask_paths::repo_glob!("crates/sync_protocol/**"),
    xtask_paths::repo_glob!("packages/collaboration/**"),
    xtask_paths::repo_glob!("tooling/sync-sim/**"),
    xtask_paths::repo_glob!("apps/web/justfile"),
    xtask_paths::repo_glob!("apps/web/vite.base.ts"),
    xtask_paths::repo_glob!("nix/tauri-desktop.nix"),
    xtask_paths::repo_glob!("packages/lexical-conformance/coverage/**"),
    xtask_paths::repo_glob!("tooling/xtask/crates/xtask_workflows/**"),
    xtask_paths::repo_glob!(".github/workflows/document_session.yml"),
    xtask_paths::repo_glob!(".github/workflows/lexical_nightly.yml"),
    xtask_paths::repo_glob!("vendor/**"),
    xtask_paths::repo_glob!(".cargo/**"),
    xtask_paths::repo_glob!("rust-toolchain.toml"),
    xtask_paths::repo_glob!("Cargo.toml"),
    xtask_paths::repo_glob!("Cargo.lock"),
    xtask_paths::repo_glob!("justfile"),
    xtask_paths::repo_glob!("flake.nix"),
    xtask_paths::repo_glob!("flake.lock"),
];
/// Called by PR CI only when Lexical paths change.
pub fn lexical_conformance() -> Workflow {
    workflow("Lexical conformance")
        .add_job("native", native(false))
        .add_job("wasm", wasm())
        .add_job("fixtures", fixtures(false))
}
/// Called independently for session paths.
pub fn document_session() -> Workflow {
    workflow("Document session").add_job("session", session())
}
fn workflow(name: &str) -> Workflow {
    Workflow::new(name)
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default().workflow_call(WorkflowCall::default()))
}
fn prepared(name: &str) -> Job {
    Job::default()
        .name(name)
        .runs_on(runners::Runner::RustCi.with_cache_tag(vars::CI_CACHE_TAG))
        .timeout_minutes(60u32)
        .add_step(steps::checkout(true, false))
        .add_step(Step::new("Clear prior execution evidence").run("rm -rf packages/lexical-conformance/coverage/results target/lexical-conformance/cases.json"))
        .add_step(steps::mount_cache_volume())
        .add_step(steps::setup_nix_with_seed())
        .add_step(steps::setup_dev_shell())
        .add_step(steps::setup_bun_pinned())
        .add_step(Step::new("Install conformance dependencies").run(
            "bun install --cwd packages/lexical-conformance --frozen-lockfile --ignore-scripts",
        ))
}
/// Native replay never suppresses failing or ledger-stale fixtures.
pub fn native(nightly: bool) -> Job {
    prepared("Native replay and traceability")
        .add_env(("PROPTEST_CASES", if nightly { "20000" } else { "256" }))
        .add_env((
            "LEXICAL_COVERAGE_BASE",
            "${{ github.event.pull_request.base.sha || github.sha }}",
        ))
        .add_step(
            Step::new("Validate traceability tooling")
                .run("bunx tsc --noEmit -p coverage/tsconfig.json\nbunx vitest run --config coverage/vitest.config.ts")
                .working_directory(xtask_paths::repo_dir!("packages/lexical-conformance")),
        )
        .add_step(
            Step::new("Model unit and handwritten tests")
                .run("bun packages/lexical-conformance/coverage/run-tests.ts"),
        )
        .add_step(
            Step::new("Replay every recorded fixture")
                .run("just lexical-replay")
                .if_condition(Expression::new("always()")),
        )
        .add_step(
            Step::new("Trace every required symbol")
                .run("just lexical-coverage-seed --check\njust lexical-coverage --check")
                .if_condition(Expression::new("always()")),
        )
        .add_step(
            steps::upload_artifact(
                "lexical-native-results",
                xtask_paths::runtime_path!("packages/lexical-conformance/coverage/results"),
            )
            .if_condition(Expression::new("always()")),
        )
        .add_step(steps::teardown_nix())
}
/// Compile the client interpreters for wasm and check the flat cross-language ABI.
pub fn wasm() -> Job {
    prepared("Wasm and boundary checks")
        .add_step(Step::new("Compile wasm interpreters").run("cargo check -p lexical_conformance -p lexical_conformance_wasm --target wasm32-unknown-unknown"))
        .add_step(Step::new("Replay every fixture on wasm32").run("just lexical-replay-wasm"))
        .add_step(Step::new("Flat ABI differential").run("cargo test -p lexical_conformance --test flat_diff").if_condition(Expression::new("always()")))
        .add_step(Step::new("Build both conformance wasm targets").run("just build-lexical-conformance-wasm").if_condition(Expression::new("always()")))
        .add_step(
            Step::new("Tier C upstream text and paragraph subset")
                .run("STEPS=10000 bunx vitest run --config diff/vitest.config.mts")
                .working_directory(xtask_paths::repo_dir!("packages/lexical-conformance"))
                .if_condition(Expression::new("always()")),
        )
        .add_step(Step::new("Development-only boundary checks").run("bun packages/lexical-conformance/coverage/boundaries.ts").if_condition(Expression::new("always()")))
        .add_step(steps::teardown_nix())
}
/// Re-record only for oracle input changes on PRs, and unconditionally nightly.
pub fn fixtures(nightly: bool) -> Job {
    let job = prepared("Pinned recorder transparency")
        .add_step(Step::new("Cache verified upstream archive")
            .uses("actions", "cache", "0400d5f644dc74513175e3cd8d07132dd4860809")
            .add_with(("path", "target/lexical-upstream.tar.gz\ntarget/lexical-upstream"))
            .add_with(("key", "lexical-upstream-${{ hashFiles('packages/lexical-conformance/upstream.lock', 'packages/lexical-conformance/record/hooks.patch') }}")));
    let job = if nightly {
        job
    } else {
        job.add_step(
            Step::new("Detect recorder input changes")
                .run("bun packages/lexical-conformance/coverage/oracle-changed.ts")
                .id("oracle")
                .add_env((
                    "LEXICAL_COVERAGE_BASE",
                    "${{ github.event.pull_request.base.sha }}",
                )),
        )
    };
    let step =
        Step::new("Re-record, replay and verify no diff").run("just lexical-fixtures --check");
    let step = if nightly {
        step
    } else {
        step.if_condition(Expression::new("steps.oracle.outputs.oracle == 'true'"))
    };
    job.add_step(step).add_step(steps::teardown_nix())
}
/// Session artifacts are checked as their implementation work packages land.
pub fn session() -> Job {
    prepared("Document session client contract")
        .add_step(
            Step::new("Session wasm, size and host contract")
                .run("bun packages/lexical-conformance/coverage/document-session.ts"),
        )
        .add_step(steps::teardown_nix())
}
