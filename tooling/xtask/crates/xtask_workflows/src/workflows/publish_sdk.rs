//! `Publish SDK` — validates and publishes `@macro-inc/sdk` when an `sdk-v*` tag
//! is pushed, or `@macro-inc/sdk-calls` when an `sdk-calls-v*` tag is. Generated
//! into `publish-sdk.yml`.

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, Push, Run, Step, Use, Workflow,
};

use crate::workflows::{sdk_check::CALLS_VALIDATION, steps};

#[cfg(test)]
mod test;

const SDK_TAG_PATTERN: &str = "sdk-v*";
const CALLS_TAG_PATTERN: &str = "sdk-calls-v*";
const IS_CALLS: &str = "startsWith(github.ref_name, 'sdk-calls-v')";

/// Build the workflow.
pub fn publish_sdk() -> Workflow {
    Workflow::new("Publish SDK")
        .on(Event::default().push(
            Push::default()
                .add_tag(SDK_TAG_PATTERN)
                .add_tag(CALLS_TAG_PATTERN),
        ))
        .concurrency(
            Concurrency::new(Expression::new("${{ github.workflow }}-${{ github.ref }}"))
                .cancel_in_progress(false),
        )
        .add_job("publish", publish())
}

fn publish() -> Job {
    Job::default()
        .name("Publish ${{ github.ref_name }}")
        // npm trusted publishing only supports GitHub-hosted runners.
        .runs_on("ubuntu-latest")
        .permissions(
            Permissions::default()
                .contents(Level::Read)
                .id_token(Level::Write),
        )
        .add_step(steps::checkout(true, false))
        .add_step(steps::setup_bun().add_with(("bun-version", "1.3.5")))
        .add_step(setup_node())
        .add_step(setup_npm())
        .add_step(verify_release())
        .add_step(install_dependencies())
        .add_step(validate())
        .add_step(install_calls_dependencies())
        .add_step(validate_calls())
        .add_step(publish_package())
        .add_step(publish_calls())
}

fn setup_node() -> Step<Use> {
    Step::new("Setup Node")
        .uses("actions", "setup-node", "v4")
        .add_with(("node-version", "24"))
        .add_with(("registry-url", "https://registry.npmjs.org"))
}

fn setup_npm() -> Step<Run> {
    Step::new("Setup npm").run("npm install --global 'npm@^11.5.1'")
}

fn verify_release() -> Step<Run> {
    Step::new("Verify release tag").run(indoc::indoc! {r#"
        case "$GITHUB_REF_NAME" in
          sdk-calls-v*)
            version="${GITHUB_REF_NAME#sdk-calls-v}"
            directory=packages/sdk-calls
            ;;
          *)
            version="${GITHUB_REF_NAME#sdk-v}"
            directory=packages/sdk
            ;;
        esac
        package_version="$(node -p "require('./$directory/package.json').version")"

        if [ "$version" != "$package_version" ]; then
          echo "tag version $version does not match package version $package_version"
          exit 1
        fi

        if ! git merge-base --is-ancestor "$GITHUB_SHA" origin/main; then
          echo "release commit $GITHUB_SHA is not on main"
          exit 1
        fi
    "#})
}

fn install_dependencies() -> Step<Run> {
    Step::new("Install dependencies")
        .run("bun install --frozen-lockfile")
        .working_directory(xtask_paths::repo_dir!("packages/sdk"))
}

fn validate() -> Step<Run> {
    Step::new("Validate SDK")
        .run("bun run check && bun test && bun run coverage && bun run build")
        .working_directory(xtask_paths::repo_dir!("packages/sdk"))
}

/// Only for an `sdk-calls-v*` tag.
fn install_calls_dependencies() -> Step<Run> {
    Step::new("Install sdk-calls dependencies")
        .run("bun install --frozen-lockfile")
        .working_directory(xtask_paths::repo_dir!("packages/sdk-calls"))
        .if_condition(Expression::new(IS_CALLS))
}

fn validate_calls() -> Step<Run> {
    Step::new("Validate sdk-calls")
        .run(CALLS_VALIDATION)
        .working_directory(xtask_paths::repo_dir!("packages/sdk-calls"))
        .if_condition(Expression::new(IS_CALLS))
}

fn publish_package() -> Step<Run> {
    Step::new("Publish package")
        .run("npm publish --access public")
        .working_directory(xtask_paths::repo_dir!("packages/sdk"))
        .if_condition(Expression::new(format!("!{IS_CALLS}")))
}

fn publish_calls() -> Step<Run> {
    Step::new("Publish sdk-calls")
        .run("npm publish --access public")
        .working_directory(xtask_paths::repo_dir!("packages/sdk-calls"))
        .if_condition(Expression::new(IS_CALLS))
}
