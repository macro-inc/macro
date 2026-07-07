//! `Fly Preview` — full-stack preview deploys on Fly Machines, plus the
//! cleanup workflow that destroys the app when the PR closes.
//!
//! Opt-in via the `preview` label. The deploy job builds every artifact on the
//! runner (service binaries, same-origin frontend bundle, init snapshot,
//! image-preload tar), stages them into a self-contained VM image
//! (`infra/preview/`), and deploys it as the per-PR Fly app `macro-pr-<N>` —
//! which suspends when idle and wakes on request. Runtime secrets reach the
//! machine as a config-scoped Doppler service token (`DOPPLER_PREVIEW_TOKEN` →
//! Fly secret `DOPPLER_TOKEN`), which the stack's env layer pulls at boot.
//!
//! NOTE: never a required status check — previews are opt-in by design.

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, PullRequest, PullRequestType, Run,
    Step, Use, Workflow,
};

use crate::workflows::{runners, steps, vars};

/// The per-PR Fly app name; also the preview hostname (`<app>.fly.dev`).
const APP_NAME: &str = "macro-pr-${{ github.event.pull_request.number }}";

/// Build the deploy workflow.
pub fn preview_fly() -> Workflow {
    Workflow::new("Fly Preview")
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_type(PullRequestType::Opened)
                .add_type(PullRequestType::Reopened)
                .add_type(PullRequestType::Synchronize)
                .add_type(PullRequestType::Labeled),
        ))
        .concurrency(
            Concurrency::new(Expression::new(
                "fly-preview-${{ github.event.pull_request.number }}",
            ))
            .cancel_in_progress(true),
        )
        .add_job("deploy", deploy())
}

/// Build the cleanup workflow (destroys the app on close / label removal).
pub fn preview_fly_cleanup() -> Workflow {
    Workflow::new("Fly Preview Cleanup")
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_type(PullRequestType::Closed)
                .add_type(PullRequestType::Unlabeled),
        ))
        .add_job("destroy", destroy())
}

fn deploy() -> Job {
    Job::default()
        // Same-repo branches only: the preview image embeds CI-built artifacts
        // and the app serves under our Fly org — never build it from fork code.
        .cond(Expression::new(
            "github.event.pull_request.head.repo.full_name == github.repository && \
             contains(github.event.pull_request.labels.*.name, 'preview')",
        ))
        .runs_on(runners::Runner::RustCi.with_cache_tag(vars::PREVIEW_FLY_CACHE_TAG))
        .permissions(
            Permissions::default()
                .contents(Level::Read)
                .pull_requests(Level::Write),
        )
        .add_env(("FLY_API_TOKEN", vars::FLY_API_TOKEN))
        .add_env(("APP_NAME", APP_NAME))
        .add_step(steps::checkout(false, true))
        .add_step(steps::mount_web_cache_volume(true))
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup dev shell + web deps", false))
        .add_step(
            Step::new("Build service binaries")
                .run("cargo x zigbuild")
                .working_directory("rust/cloud-storage"),
        )
        .add_step(
            Step::new("Build xtask (runs inside the preview VM)")
                .run("cargo build --release -p xtask")
                .working_directory("rust/cloud-storage"),
        )
        .add_step(
            Step::new("Build frontend bundle (same-origin)")
                .run("bun run --bun build")
                .working_directory("js/app/packages/app")
                .add_env(("MODE", "development"))
                .add_env(("NODE_ENV", "production"))
                .add_env(("VITE_LOCAL_SERVERS", "ALL"))
                .add_env(("VITE_LOCAL_BACKEND_ORIGIN", "same-origin")),
        )
        .add_step(bake_snapshot())
        .add_step(bake_preload_tar())
        .add_step(stage_context())
        .add_step(setup_flyctl())
        .add_step(deploy_to_fly())
        .add_step(comment_preview_url())
}

/// A cold `stack up` on the runner runs the real init (migrate, kickstart,
/// indices) and saves the content-addressed snapshot the VM restores from. It
/// also pulls/builds every image the stack runs, which the preload step bakes.
fn bake_snapshot() -> Step<Run> {
    Step::new("Bake init snapshot")
        .run(indoc::indoc! {r#"
            cargo x stack up --no-frontend --no-doppler --no-build
            cargo x stack snapshot --json
        "#})
        .working_directory("rust/cloud-storage")
}

fn bake_preload_tar() -> Step<Run> {
    Step::new("Bake image preload tar").run(indoc::indoc! {r#"
        set -euo pipefail
        mkdir -p preview-ctx/preload
        docker pull alpine:3
        images=$(docker compose -p macro \
          -f docker-compose.yml \
          -f infra/local/generated/macro/docker-compose.override.yml \
          --env-file infra/local/generated/macro/local.generated.env \
          config --images | sort -u)
        echo "baking images:" $images
        docker save -o preview-ctx/preload/images.tar $images alpine:3
    "#})
}

fn stage_context() -> Step<Run> {
    Step::new("Stage preview build context").run(indoc::indoc! {r#"
        set -euo pipefail
        ctx=preview-ctx
        mkdir -p "$ctx/repo" "$ctx/artifacts/binaries" "$ctx/bin"
        # The minimal repo layout xtask reads at runtime — including every
        # snapshot-key input, byte-identical to this checkout, so the VM's
        # key matches the snapshot baked above.
        rsync -a --relative --exclude node_modules \
          docker-compose.yml \
          docker-compose-databases.yml \
          infra/stacks/fusionauth-instance/docker-compose.yml \
          infra/local/nginx \
          infra/local/opensearch \
          infra/stacks/opensearch/helpers \
          rust/cloud-storage/macro_db_client/migrations \
          "$ctx/repo/"
        # Service binaries only — the target dir also holds gigabytes of
        # build intermediates.
        find rust/cloud-storage/target/x86_64-unknown-linux-gnu/debug \
          -maxdepth 1 -type f -executable ! -name '*.d' ! -name '*.so' \
          -exec cp {} "$ctx/artifacts/binaries/" \;
        cp -r js/app/packages/app/dist "$ctx/artifacts/frontend-dist"
        cp -r infra/local/generated/.snapshots "$ctx/artifacts/snapshots"
        cp rust/cloud-storage/target/release/xtask "$ctx/bin/xtask"
        cp infra/preview/entrypoint.sh "$ctx/entrypoint.sh"
        cp infra/preview/Dockerfile "$ctx/Dockerfile"
    "#})
}

fn setup_flyctl() -> Step<Use> {
    Step::new("Setup flyctl").uses(
        "superfly",
        "flyctl-actions/setup-flyctl",
        "ed8efb33836e8b2096c7fd3ba1c8afe303ebbff1",
    ) // 1.6
}

/// Create the app if needed, stage the Doppler service token as the machine's
/// `DOPPLER_TOKEN` (the stack's env layer pulls preview secrets with it at
/// boot), then push the staged image and deploy.
fn deploy_to_fly() -> Step<Run> {
    Step::new("Deploy to Fly")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            if [ -z "$DOPPLER_PREVIEW_TOKEN" ]; then
              echo "DOPPLER_PREVIEW_TOKEN secret is not set (a Doppler service token scoped to the preview config)" >&2
              exit 1
            fi
            flyctl apps create "$APP_NAME" --org "$FLY_ORG" || true
            flyctl secrets set --app "$APP_NAME" --stage "DOPPLER_TOKEN=$DOPPLER_PREVIEW_TOKEN"
            flyctl auth docker
            image="registry.fly.io/$APP_NAME:${{ github.sha }}"
            docker build -t "$image" preview-ctx
            docker push "$image"
            flyctl deploy --app "$APP_NAME" \
              --config infra/preview/fly.toml \
              --image "$image" \
              --yes
        "#})
        .add_env(("FLY_ORG", "${{ vars.FLY_ORG }}"))
        .add_env(("DOPPLER_PREVIEW_TOKEN", vars::DOPPLER_PREVIEW_TOKEN))
}

fn comment_preview_url() -> Step<Use> {
    Step::new("Comment preview URL")
        .uses(
            "actions",
            "github-script",
            "f28e40c7f34bde8b3046d885e986cb6290c5673b",
        )
        .add_with(("github-token", "${{ secrets.GITHUB_TOKEN }}"))
        .add_with((
            "script",
            indoc::indoc! {r#"
                const app = process.env.APP_NAME;
                const url = `https://${app}.fly.dev`;
                const marker = '<!-- fly-preview -->';
                const body = [
                  marker,
                  `🚀 **Full-stack preview**: ${url}`,
                  '',
                  `- Suspended when idle — the first request wakes it (a few seconds).`,
                  `- Log in with any email; the passwordless code lands in [Mailpit](${url}/mailpit/).`,
                  `- Deployed from ${context.payload.pull_request.head.sha.slice(0, 7)}.`,
                ].join('\n');
                const { data: comments } = await github.rest.issues.listComments({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  issue_number: context.issue.number,
                  per_page: 100,
                });
                const existing = comments.find(c => c.body && c.body.startsWith(marker));
                if (existing) {
                  await github.rest.issues.updateComment({
                    owner: context.repo.owner,
                    repo: context.repo.repo,
                    comment_id: existing.id,
                    body,
                  });
                } else {
                  await github.rest.issues.createComment({
                    owner: context.repo.owner,
                    repo: context.repo.repo,
                    issue_number: context.issue.number,
                    body,
                  });
                }
            "#},
        ))
}

fn destroy() -> Job {
    Job::default()
        // Closed PRs always attempt cleanup (destroy is a no-op if no app);
        // unlabeled only cleans up when the removed label is `preview`.
        .cond(Expression::new(
            "github.event.action == 'closed' || github.event.label.name == 'preview'",
        ))
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .permissions(Permissions::default().contents(Level::Read))
        .add_env(("FLY_API_TOKEN", vars::FLY_API_TOKEN))
        .add_step(setup_flyctl())
        .add_step(
            Step::new("Destroy app")
                .run(format!("flyctl apps destroy \"{APP_NAME}\" --yes || true")),
        )
}
