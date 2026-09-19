//! `Docs Check` — fails a PR if the generated MCP tool reference under
//! `apps/docs/` has drifted from the Rust tool registry. The pages, their
//! nav list, and the `Tool Reference` group in `docs.json` are all written by
//! `apps/docs/scripts/generate-mcp-tool-pages.ts`, which builds the
//! `gen_tool_schemas` binary and renders from its JSON. Without this check the
//! docs site silently rots every time a tool's schema or description changes.

use gh_workflow::{Concurrency, Event, Expression, Job, PullRequest, Run, Step, Workflow};

use crate::workflows::{runners, steps, vars};

/// Build the workflow.
pub fn docs_check() -> Workflow {
    Workflow::new("Docs Check")
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_branch("main")
                .add_path(xtask_paths::repo_glob!("apps/docs/**"))
                // Tool schemas are derived from types spread across the
                // workspace, not just `crates/ai_tools`, so watch all Rust.
                .add_path(xtask_paths::repo_glob!("crates/**/*.rs"))
                .add_path(xtask_paths::repo_glob!("Cargo.toml"))
                .add_path(xtask_paths::repo_glob!("Cargo.lock"))
                .add_path(".github/workflows/docs-check.yml"),
        ))
        .concurrency(
            Concurrency::new(Expression::new(
                "${{ github.workflow }}-${{ github.ref }}-check",
            ))
            .cancel_in_progress(true),
        )
        .add_job("check-docs", check_docs())
}

/// Regenerate the tool reference and fail on drift. Shares the web CI cache
/// volume and sccache with `sdk-check`: both jobs build one small binary out of
/// the same workspace, so they warm the same cache.
fn check_docs() -> Job {
    Job::default()
        .name("Docs Generated Code Check")
        .runs_on(runners::Runner::Mid.with_cache_tag(vars::WEB_CI_CACHE_TAG))
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_web_cache_volume(true))
        .add_step(steps::setup_rust_sccache())
        .add_step(steps::setup_bun())
        .add_step(steps::configure_namespace_sccache(vars::WEB_SCCACHE_NAME))
        .add_step(generate_tool_pages())
        .add_step(steps::show_sccache_stats())
        .add_step(verify_fresh())
}

fn generate_tool_pages() -> Step<Run> {
    Step::new("Regenerate MCP tool pages")
        .run("bun run generate:tools")
        .working_directory("apps/docs")
}

fn verify_fresh() -> Step<Run> {
    Step::new("Verify generated docs are fresh").run(indoc::indoc! {r#"
        if [ -n "$(git status --porcelain -- apps/docs)" ]; then
          echo "apps/docs tool reference is stale. Run 'bun run generate:tools' in apps/docs and commit the result."
          git status --porcelain -- apps/docs
          git diff -- apps/docs | head -200
          exit 1
        fi
    "#})
}
