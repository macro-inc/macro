//! `Regenerate Generated Code` — after a merge, rebuilds everything generated from
//! Rust (OpenAPI clients, the SDK, docs tool pages, specta types) and opens or
//! updates one pull request when the result differs from `main`. This takes the
//! place of a check on every pull request: the build runs at about 80 s past a
//! long chain of crates that most Rust changes reach, which no runner size or
//! cache brought under five minutes.
//! Generated into `regenerate_generated_code.yml`.

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, Push, Run, Step, Use, Workflow,
};

use crate::workflows::{runners, steps, vars};

#[cfg(test)]
mod test;

/// Every path a generator writes to.
const GENERATED_PATHS: &str = "apps/web/src/lib/service-clients \\
  apps/web/src/lib/core/database-sql/generated \\
  apps/web/src/features/dynamic-ui/generated \\
  packages/lexical-core/generated \\
  packages/sdk \\
  apps/docs";

/// A pull request opened with the workflow's own token starts no checks, so it
/// could never pass the required ones. This token comes from an account that may
/// push branches and open pull requests; without it the pull request still opens,
/// and someone has to close and reopen it to start its checks.
const BOT_TOKEN: &str = "${{ secrets.GENERATED_CODE_BOT_TOKEN || github.token }}";

/// Build the workflow.
pub fn regenerate_generated_code() -> Workflow {
    Workflow::new("Regenerate Generated Code")
        .on(Event::default().push(
            Push::default()
                .add_branch("main")
                .add_path(xtask_paths::repo_glob!("crates/**/*.rs"))
                .add_path(xtask_paths::repo_glob!("services/**/*.rs"))
                .add_path(xtask_paths::repo_file!("Cargo.toml"))
                .add_path(xtask_paths::repo_file!("Cargo.lock"))
                .add_path(xtask_paths::repo_file!(
                    "apps/web/scripts/generate-api-schema.ts"
                ))
                .add_path(xtask_paths::repo_file!("apps/web/scripts/services.ts"))
                .add_path(xtask_paths::repo_glob!("packages/sdk/**"))
                .add_path(xtask_paths::repo_glob!("apps/docs/**"))
                .add_path(xtask_paths::repo_file!(
                    ".github/workflows/regenerate_generated_code.yml"
                )),
        ))
        // The newest commit covers everything an older run would have found.
        .concurrency(
            Concurrency::new(Expression::new("${{ github.workflow }}")).cancel_in_progress(true),
        )
        .add_job("regenerate", regenerate())
}

fn regenerate() -> Job {
    Job::default()
        .name("Regenerate and propose")
        .cond(Expression::new("github.ref == 'refs/heads/main'"))
        .runs_on(runners::Runner::Mid.with_cache_tag(vars::WEB_CI_CACHE_TAG))
        .permissions(
            Permissions::default()
                .contents(Level::Write)
                .pull_requests(Level::Write),
        )
        // The generators run once and are thrown away, so debug info is pure
        // cost: it made the 15 binaries 12.7 GB instead of 466 MB. Job-level, so
        // every cargo call here resolves the same profile and reuses one set of
        // artifacts.
        .add_env(("CARGO_PROFILE_DEV_DEBUG", "0"))
        .add_env(("RUSTFLAGS", "-C link-arg=-fuse-ld=mold"))
        .add_step(checkout())
        .add_step(steps::mount_web_cache_volume(true))
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup Prereqs", false))
        .add_step(steps::configure_namespace_sccache(vars::WEB_SCCACHE_NAME))
        .add_step(steps::code_mode_assets())
        .add_step(build_schema_binaries())
        .add_step(generate_api_types())
        .add_step(regenerate_sdk())
        .add_step(regenerate_tool_pages())
        // Last: its `cargo run -p` builds resolve features per package, so
        // running them earlier would make the steps above recompile.
        .add_step(regenerate_specta_types())
        .add_step(propose_changes())
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
}

fn checkout() -> Step<Use> {
    Step::new("Checkout Repo")
        .uses(
            "actions",
            "checkout",
            "df4cb1c069e1874edd31b4311f1884172cec0e10",
        ) // v6
        .add_with(("token", BOT_TOKEN))
}

fn build_schema_binaries() -> Step<Run> {
    Step::new("Build schema binaries").run(indoc::indoc! {r#"
        set -euo pipefail
        read -ra openapi_bins <<< "$(cd apps/web && bun scripts/generate-api-schema.ts --print-cargo-bins)"
        SQLX_OFFLINE=true cargo build "${openapi_bins[@]}" --bin gen_tool_schemas
    "#})
}

fn generate_api_types() -> Step<Run> {
    Step::new("Generate API Types")
        .run("bun run gen-api")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

fn regenerate_sdk() -> Step<Run> {
    Step::new("Regenerate SDK code")
        .run(indoc::indoc! {r#"
            bun install --frozen-lockfile
            bun run sync-specs
            bun run generate
        "#})
        .working_directory(xtask_paths::repo_dir!("packages/sdk"))
}

fn regenerate_tool_pages() -> Step<Run> {
    Step::new("Regenerate MCP tool pages")
        .run("bun run generate:tools")
        .working_directory(xtask_paths::repo_dir!("apps/docs"))
}

fn regenerate_specta_types() -> Step<Run> {
    Step::new("Regenerate Specta Types")
        .run(indoc::indoc! {r#"
            just gen-agent-fold-types
            just gen-database-sql-types
            just gen-dynamic-ui-types
            just gen-agent-review-types
        "#})
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

/// Opens one pull request, keeps it current as `main` moves, and closes it once
/// `main` no longer differs. Paths are explicit because setup edits `bunfig.toml`.
fn propose_changes() -> Step<Run> {
    Step::new("Open or update the pull request")
        .run(format!(
            r#"set -euo pipefail
branch=bot/regenerate-generated-code
paths=({GENERATED_PATHS})
open_pr=$(gh pr list --head "$branch" --state open --json number --jq '.[0].number // empty')
if [ -z "$(git status --porcelain -- "${{paths[@]}}")" ]; then
  echo "Generated code on main is up to date."
  if [ -n "$open_pr" ]; then
    gh pr close "$open_pr" --delete-branch --comment "Generated code on main is up to date again."
  fi
  exit 0
fi
git status --porcelain -- "${{paths[@]}}"
git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git switch -C "$branch"
git add -- "${{paths[@]}}"
git commit -m "chore(generated): regenerate from main at ${{GITHUB_SHA:0:10}}"
git push --force origin "$branch"
if [ -z "$open_pr" ]; then
  gh pr create --base main --head "$branch"     --title "chore(generated): regenerate code from main"     --body "Generated code on main differs from what its Rust sources produce. Created by the Regenerate Generated Code workflow, which keeps this branch current as main moves and closes the pull request once main matches."
fi
"#
        ))
        .add_env(("GH_TOKEN", BOT_TOKEN))
}
