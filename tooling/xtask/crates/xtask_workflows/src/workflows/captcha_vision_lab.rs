//! `CAPTCHA vision lab` — the lab's whole check
//! (`packages/captcha-vision-lab`), browser tests included. Generated into
//! `captcha_vision_lab.yml`.
//!
//! It is not part of `PR CI`, so `CI gate` does not wait for it: while Bun drove
//! Chromium, its browser sessions stalled at random on the runners, and it
//! failed pull requests whatever they changed. `Browser Tests` keeps the lab's
//! checks that start no browser (`web_app_check_main.rs`). This runs nightly on
//! `main`, on pushes to `main` that change the lab, and on a branch by hand
//! (`workflow_dispatch`).
//!
//! Node drives Chromium now. The browser tests go back into `Browser Tests`
//! once they have passed 20 runs in a row that way: at that count a suite still
//! failing one run in seven would show it 19 times in 20.

use gh_workflow::{
    Event, Job, Level, Permissions, Push, Run, Schedule, Step, Workflow, WorkflowDispatch,
};

use crate::workflows::{runners, steps, vars};

#[cfg(test)]
mod test;

/// 06:00 UTC, when little else is building.
const NIGHTLY: &str = "0 6 * * *";

/// Minutes the job may take. A passing run takes about two. Each stalled test
/// can add up to a minute, and a run has had at most two.
const JOB_MINUTES: u32 = 20;

/// Build the workflow.
pub fn captcha_vision_lab() -> Workflow {
    Workflow::new("CAPTCHA vision lab")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default()
            .push(
                Push::default()
                    .add_branch("main")
                    .add_path(xtask_paths::repo_glob!("packages/captcha-vision-lab/**").as_str())
                    .add_path(
                        xtask_paths::repo_glob!(".github/workflows/captcha_vision_lab.yml")
                            .as_str(),
                    ),
            )
            .add_schedule(Schedule::new(NIGHTLY))
            .workflow_dispatch(WorkflowDispatch::default()))
        .add_job("lab", lab())
}

/// The same runner and dev shell as `Browser Tests`, so a pass here says
/// something about one there.
fn lab() -> Job {
    Job::default()
        .name("CAPTCHA vision lab")
        .timeout_minutes(JOB_MINUTES)
        .runs_on(runners::Runner::Mid.with_cache_tag(vars::WEB_CI_CACHE_TAG))
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix_with_seed())
        .add_step(steps::setup_dev_shell())
        .add_step(run_lab_check())
        .add_step(steps::teardown_nix())
}

const LAB_CHECK: &str = indoc::indoc! {r#"
    bun install --frozen-lockfile
    ./node_modules/.bin/playwright install --with-deps chromium
    env -u LD_LIBRARY_PATH -u BASH_ENV bun run check
"#};

/// The lab is outside the root workspace: its own install and its own
/// Playwright's Chromium, then its typecheck and tests with the mock planner
/// and the loopback provider stand-in only. Clear BASH_ENV as well as
/// LD_LIBRARY_PATH because Bun's script shell would restore the Nix libraries,
/// which are incompatible with Playwright's Chromium.
fn run_lab_check() -> Step<Run> {
    Step::new("CAPTCHA Vision Lab Tests")
        .run(LAB_CHECK.trim_end())
        .working_directory(xtask_paths::repo_dir!("packages/captcha-vision-lab"))
}
