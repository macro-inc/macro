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
        // Share the CI compile cache volume (nix store + sccache + cargo):
        // this job compiles the same workspace as the check/test jobs, so its
        // sccache entries are the same content-addressed set — a bespoke tag
        // just means a permanently cold volume. The cargo target dir rides the
        // same volume so the zigbuild is incremental across runs.
        .runs_on(runners::Runner::RustCi.with_cache_tag(vars::CI_CACHE_TAG))
        .permissions(
            Permissions::default()
                .contents(Level::Read)
                .pull_requests(Level::Write),
        )
        .add_env(("FLY_API_TOKEN", vars::FLY_API_TOKEN))
        .add_env(("APP_NAME", APP_NAME))
        .add_step(steps::checkout(false, true))
        .add_step(steps::mount_cache_volume_with_cargo_target())
        // Namespace remote builder: persistent BuildKit layer cache across
        // runs, same as the deploy workflows use. The aux-image builds and the
        // preview-image build both go through it.
        .add_step(
            Step::new("Set up Namespace Docker builder").uses(
                "namespacelabs",
                "nscloud-setup-buildx-action",
                "d059ed7184f0bc7c8b27e8810cea153d02bcc6dd",
            ), // v0.0.23
        )
        // Fail fast: the Docker-built aux images are the most fragile part of
        // a fresh bring-up (stale local images mask their rot) and need
        // nothing from nix/cargo — build them before the expensive toolchain
        // setup so a broken Dockerfile fails in ~2 minutes, not ~12. The bake
        // step's `stack up` then reuses these images instead of building.
        .add_step(Step::new("Build aux service images (fail fast)").run(
            "docker compose -p macro -f docker-compose.yml build \
             search sync_service websocket_service lexical_service",
        ))
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup dev shell + web deps", false))
        .add_step(steps::pin_sccache_dir())
        .add_step(
            Step::new("Build service binaries")
                .run(indoc::indoc! {r#"
                    cargo x zigbuild
                    sccache --show-stats
                "#})
                .working_directory("rust/cloud-storage"),
        )
        .add_step(
            // xtask_local, not the dependency-free `xtask` launcher (which
            // just re-invokes cargo — useless in the VM). Deliberately WITHOUT
            // the `local-stack` feature: the VM restores the baked snapshot,
            // whose Kafka volume already carries the topics, so it never
            // provisions Kafka — and skipping rdkafka means no
            // dynamically-linked librdkafka to ship into the VM.
            Step::new("Build xtask_local (runs inside the preview VM)")
                .run("cargo build --release -p xtask_local")
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
        .add_step(dump_stack_diagnostics())
        .add_step(bake_preload_tar())
        .add_step(stage_context())
        .add_step(setup_flyctl())
        .add_step(deploy_to_fly())
        .add_step(comment_preview_url())
}

/// A cold `stack up --infra-only` on the runner runs the real init (migrate,
/// kickstart, Kafka topics, indices) and saves the content-addressed snapshot
/// the VM restores from. Infra only: the app services need the Doppler-sourced
/// env to boot, which this runner deliberately lacks — the snapshot captures
/// only the infra volumes anyway. Via `just` (not the bare `cargo x` alias)
/// because the justfile enables the `local-stack` feature the Kafka
/// provisioning needs.
fn bake_snapshot() -> Step<Run> {
    Step::new("Bake init snapshot").run(indoc::indoc! {r#"
        just stack up --infra-only --no-doppler --no-build
        just stack snapshot --json
    "#})
}

/// When the bake dies (typically the backend health gate), the answer is in
/// the service logs — dump container states and recent logs so a failed run is
/// diagnosable from CI output alone.
fn dump_stack_diagnostics() -> Step<Run> {
    Step::new("Dump stack diagnostics")
        .run(indoc::indoc! {r#"
            docker compose -p macro ps --all || true
            for svc in authentication-service proxy fusionauth postgres kafka \
                       connection_gateway document_storage_service email_service \
                       notification_service contacts_service; do
              echo "==================== $svc ===================="
              docker compose -p macro logs --no-color --tail 80 "$svc" 2>&1 || true
            done
        "#})
        .if_condition(Expression::new("failure()"))
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
        # The infra-only bake never starts the app layer, so images only it
        # runs (proxy, mailpit) haven't been pulled yet.
        for img in $images; do
          docker image inspect "$img" >/dev/null 2>&1 || docker pull "$img"
        done
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
        cp rust/cloud-storage/target/release/xtask_local "$ctx/bin/xtask"
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
