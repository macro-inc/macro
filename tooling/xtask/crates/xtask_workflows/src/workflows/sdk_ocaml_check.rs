//! `OCaml SDK Check` — builds and tests `packages/sdk-ocaml` in its Nix shell,
//! including the check that its committed `generated/` matches
//! `packages/sdk/specs`, then builds the WebAssembly libraries (the transport
//! and `code_mode`) and runs their tests under Deno, and builds code mode's
//! OCaml bundle and runs a sample program against it. Generated into
//! `sdk-ocaml-check.yml`.

use gh_workflow::{Event, Job, Level, Permissions, Push, Run, Step, Workflow, WorkflowCall};
use xtask_paths::RepoGlob;

use crate::workflows::{runners, steps, vars};

#[cfg(test)]
mod test;

/// Files whose change makes `PR CI` call this workflow, and that runs it on
/// `main`. The specs and the TypeScript host table are inputs of the OCaml
/// SDK's tests, and the Wasm transport's tests compare operation names with
/// the TypeScript SDK's generated methods; `flake.lock` pins its toolchain;
/// `nix/cloud-storage.nix` defines code mode's OCaml bundle; the agent
/// permission registry must classify every operation the SDK has.
pub const PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("packages/sdk-ocaml/**"),
    xtask_paths::repo_glob!("packages/sdk/specs/**"),
    xtask_paths::repo_glob!("packages/sdk/src/config.ts"),
    xtask_paths::repo_glob!("packages/sdk/generated/*/sdk.gen.ts"),
    xtask_paths::repo_glob!("crates/agent_permission_registry/registry.json"),
    xtask_paths::repo_glob!("flake.lock"),
    xtask_paths::repo_glob!("nix/cloud-storage.nix"),
    xtask_paths::repo_glob!(".github/workflows/sdk-ocaml-check.yml"),
];

/// Build the workflow.
pub fn sdk_ocaml_check() -> Workflow {
    Workflow::new("OCaml SDK Check")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default()
            // A spec sync on main that leaves generated/ stale fails here.
            .push(
                PATHS
                    .iter()
                    .fold(Push::default().add_branch("main"), |trigger, path| {
                        trigger.add_path(*path)
                    }),
            )
            .workflow_call(WorkflowCall::default()))
        .concurrency(vars::concurrency("sdk-ocaml-check"))
        .add_job("check-ocaml-sdk", check_ocaml_sdk())
}

/// A cold Nix setup takes up to 9 minutes; the build and tests take under 2.
fn check_ocaml_sdk() -> Job {
    Job::default()
        .timeout_minutes(20u32)
        .name("OCaml SDK build and test")
        .runs_on(runners::Runner::Small.to_string())
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(build_and_test())
        .add_step(wasm_libraries())
        .add_step(code_mode_bundle())
        .add_step(steps::teardown_nix())
}

fn build_and_test() -> Step<Run> {
    Step::new("dune build && dune test (with the drift check)")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            nix-shell packages/sdk-ocaml/shell.nix --run "cd packages/sdk-ocaml && dune build && dune test"
        "#})
        .timeout_minutes(10u32)
}

/// `macro_sdk_fetch` and `code_mode` build only in the `wasm` profile, in
/// their own build directory so they don't rebuild the native tree.
fn wasm_libraries() -> Step<Run> {
    Step::new("Wasm libraries: dune build --profile wasm @fetch/runtest @code_mode/runtest (Deno)")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            nix-shell packages/sdk-ocaml/shell.nix --run "cd packages/sdk-ocaml && dune build --profile wasm --build-dir _build_wasm @fetch/runtest @code_mode/runtest"
        "#})
        .timeout_minutes(10u32)
}

/// Builds the `code-mode-ocaml` bundle and compiles and runs a sample program
/// with only its toolchain (no dune, no ocamlfind), under Deno 2.9.6.
fn code_mode_bundle() -> Step<Run> {
    Step::new("Code-mode OCaml bundle: nix build the sample check")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            nix build --no-link --print-build-logs .#checks.x86_64-linux.code-mode-ocaml-sample
        "#})
        .timeout_minutes(10u32)
}
