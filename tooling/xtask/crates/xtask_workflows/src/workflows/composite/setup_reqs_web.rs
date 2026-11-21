//! `Setup Prereqs Web`: the web app's dev shell and `bun install`, plus
//! Playwright's browsers when asked.

use gh_workflow::expr::typed::{Bool, Expr, Str, env, input, runner};
use gh_workflow::{ActionInput, CompositeAction, Step, ZizmorRule};

use crate::workflows::actions::{LocalSetupNixDevShell, RunsOnCacheRestore, RunsOnCacheSave};

const PLAYWRIGHT_BROWSERS_DIR: &str = "~/.cache/ms-playwright";

/// The step id of the Playwright browser cache restore.
const RESTORE_BROWSERS: &str = "pw-browsers";

pub fn setup_reqs_web() -> CompositeAction {
    let playwright = || input::<Str>("playwright");
    let browsers_key = || format!("pw-browsers-{}-{}", runner().os(), env("PW_VERSION"));

    // `force` always installs; `true` installs on a cache miss.
    let install_browsers = || -> Expr<Bool> {
        playwright().eq("force").or(playwright().eq("true").and(
            RunsOnCacheRestore::cache_hit_output(RESTORE_BROWSERS)
                .read()
                .ne("true"),
        ))
    };

    CompositeAction::new(
        "Setup Prereqs Web",
        "Checkout and Setup Prerequisite Dependencies for web app",
    )
    .add_input(
        "playwright",
        ActionInput::optional("Install Playwright and cache", ""),
    )
    .add_step(LocalSetupNixDevShell::new("Setup Nix dev shell"))
    .add_step(
        Step::new("Setup bunfig.toml")
            .run("echo \"[run]\" >> bunfig.toml\necho \"bun = true\" >> bunfig.toml\n")
            .shell("bash"),
    )
    // The web PR checks keep the root node_modules on their cache volume
    // (`vars::node_modules_volume_dir`), so there this only checks the tree
    // against bun.lock. Bun adds and updates packages but never removes one the
    // lockfile dropped, so a tree another lockfile installed is emptied first:
    // a package left over from another PR must not make imports resolve.
    // node_modules can be a mount point, so it is emptied rather than removed.
    .add_step(
        Step::new("Install Dependencies")
            .run(include_str!("setup_reqs_web/install_dependencies.sh"))
            .shell("bash"),
    )
    .add_step(
        Step::new("Get Playwright version (for caching)")
            .run("echo \"PW_VERSION=$(bunx playwright --version | cut -d' ' -f2)\" >> $GITHUB_ENV")
            .if_condition(playwright().eq("true"))
            .shell("bash")
            .zizmor_ignore(
                ZizmorRule::GithubEnv,
                "exports the Playwright version for the cache key",
            )
            .working_directory("apps/web"),
    )
    .add_step(
        RunsOnCacheRestore::new(
            "Restore Playwright browsers",
            PLAYWRIGHT_BROWSERS_DIR,
            browsers_key(),
        )
        .step()
        .if_condition(playwright().eq("true"))
        .id(RESTORE_BROWSERS),
    )
    .add_step(
        Step::new("Install Playwright Browsers")
            .run("bunx playwright install --with-deps chromium")
            .if_condition(install_browsers())
            .shell("bash")
            .working_directory("apps/web"),
    )
    .add_step(
        RunsOnCacheSave::new(
            "Save Playwright browsers to cache",
            PLAYWRIGHT_BROWSERS_DIR,
            browsers_key(),
        )
        .step()
        .if_condition(install_browsers()),
    )
}
