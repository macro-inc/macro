//! `Fly Preview` — full-stack preview deploys on Fly Machines, plus the
//! cleanup workflow that destroys the app when the PR closes.
//!
//! Opt-in via the `preview` label. The deploy job builds every artifact on the
//! runner (service binaries, same-origin frontend bundle, init snapshot),
//! mirrors every stack image into the per-PR app's Fly registry repo, stages
//! the rest into a slim VM image (`infra/preview/`), and deploys it as the
//! per-PR Fly app `macro-pr-<N>` — which suspends when idle and wakes on
//! request. The machine pulls the stack images at boot (layer-level dedup
//! against its persistent /var/lib/docker volume) instead of shipping them
//! inside the VM image. Runtime secrets reach the machine as a config-scoped
//! Doppler service token (`DOPPLER_PREVIEW_TOKEN` → Fly secret
//! `DOPPLER_TOKEN`), which the stack's env layer pulls at boot.
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
        // Dedicated cache volume pool (nix store + sccache + cargo target):
        // see PREVIEW_CACHE_TAG for why sharing the check/test jobs' pool was
        // measured cold on both layers (different --target = disjoint sccache
        // keys, and their volumes never carry a cargo target dir).
        .runs_on(runners::Runner::RustCi.with_cache_tag(vars::PREVIEW_CACHE_TAG))
        .permissions(
            Permissions::default()
                .contents(Level::Read)
                .pull_requests(Level::Write),
        )
        .add_env(("FLY_API_TOKEN", vars::FLY_API_TOKEN))
        .add_env(("APP_NAME", APP_NAME))
        // Init snapshots live on the cache volume: an unchanged key skips the
        // whole infra bake and keeps snapshot bytes (→ VM image layer) stable.
        .add_env((
            "MACRO_STACK_SNAPSHOT_DIR",
            vars::PREVIEW_SNAPSHOT_VOLUME_DIR,
        ))
        // No incremental in CI: incremental caches are what bloated the cache
        // volume to 41G (making it the workspace's eviction victim — observed
        // volume loss between runs), and sccache refuses to cache incremental
        // compiles, so they also locked workspace crates out of sccache.
        // Cargo's fingerprint reuse (what makes warm runs fast) is unaffected.
        // Local run_local keeps incremental for the edit-rebuild loop.
        .add_env(("CARGO_INCREMENTAL", "0"))
        .add_step(steps::checkout(false, true))
        .add_step(steps::mount_cache_volume_with_cargo_target())
        // CARGO_INCREMENTAL=0 stops incremental caches being written, but the
        // ~25G already on older volumes never gets cleaned by cargo — it's
        // exactly the weight that made this pool the workspace quota's
        // eviction victim. Deleting is idempotent and instant when clean.
        .add_step(Step::new("Prune stale incremental caches").run(
            "rm -rf rust/cloud-storage/target/*/debug/incremental \
             rust/cloud-storage/target/debug/incremental",
        ))
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
        // Fail fast: the Docker-built images are the most fragile part of a
        // fresh bring-up (stale local images mask their rot) and need nothing
        // from nix/cargo — build them before the expensive toolchain setup so
        // a broken Dockerfile fails in ~2 minutes, not ~12. This is also the
        // ONLY thing that builds them now: the infra-only bake never starts
        // the app layer, so the registry mirror ships exactly what's built here.
        .add_step(Step::new("Build compose service images (fail fast)").run(
            "docker compose -p macro -f docker-compose.yml build \
             search sync_service websocket_service lexical_service ai_editing_worker",
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
            // dynamically-linked librdkafka to ship into the VM. zigbuild,
            // not a host build: the nix dev shell links the /nix/store ELF
            // interpreter, which doesn't exist in the VM image (exit 127,
            // "required file not found").
            Step::new("Build xtask_local (runs inside the preview VM)")
                .run("cargo zigbuild --release --target x86_64-unknown-linux-gnu.2.36 -p xtask_local")
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
        .add_step(stage_context())
        .add_step(setup_flyctl())
        .add_step(deploy_to_fly())
        .add_step(dump_fly_diagnostics())
        .add_step(dump_boot_timings())
        .add_step(comment_preview_url())
}

/// When the machine never passes its health check, the answer is inside the
/// VM (dockerd, image load, `stack up`) — dump its logs and state so a failed
/// deploy is diagnosable from CI output alone.
fn dump_fly_diagnostics() -> Step<Run> {
    Step::new("Dump Fly diagnostics")
        .run(indoc::indoc! {r#"
            flyctl machine list --app "$APP_NAME" || true
            flyctl logs --app "$APP_NAME" --no-tail || true
        "#})
        .if_condition(Expression::new("failure()"))
}

/// The entrypoint logs how long each boot phase took (image pulls, stack up),
/// but Fly's log retention is short and nobody looks at a healthy machine —
/// surface the `[preview]` lines in CI so every deploy records its boot
/// breakdown next to the deploy timings.
fn dump_boot_timings() -> Step<Run> {
    Step::new("Dump boot timings")
        .run(r#"flyctl logs --app "$APP_NAME" --no-tail | grep -E '\[preview\]|✓' || true"#)
}

/// A cold `stack up --infra-only` on the runner runs the real init (migrate,
/// kickstart, Kafka topics, indices) and saves the content-addressed snapshot
/// the VM restores from. Infra only: the app services need the Doppler-sourced
/// env to boot, which this runner deliberately lacks — the snapshot captures
/// only the infra volumes anyway. Via `just` (not the bare `cargo x` alias)
/// because the justfile enables the `local-stack` feature the Kafka
/// provisioning needs.
///
/// The store lives on the cache volume (MACRO_STACK_SNAPSHOT_DIR), so when the
/// init inputs are unchanged the snapshot is already there and the entire
/// bring-up is skipped — only the generated compose override (which `up` would
/// have written, and the mirror step reads) still needs producing. The final
/// `snapshot --json` line lands in $RUNNER_TEMP for the stage step, which
/// ships exactly that key's directory.
fn bake_snapshot() -> Step<Run> {
    Step::new("Bake init snapshot").run(indoc::indoc! {r#"
        set -euo pipefail
        mkdir -p "$MACRO_STACK_SNAPSHOT_DIR"
        status=$(just stack snapshot --json | tail -n 1)
        if echo "$status" | jq -e '.present' >/dev/null; then
          echo "init snapshot cache hit: $status"
          cargo run --quiet --manifest-path rust/cloud-storage/Cargo.toml \
            -p xtask_local --features local-stack -- gen-compose
        else
          just stack up --infra-only --no-doppler --no-build
          status=$(just stack snapshot --json | tail -n 1)
          echo "$status" | jq -e '.present' >/dev/null
        fi
        echo "$status" > "$RUNNER_TEMP/preview-snapshot.json"
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

fn stage_context() -> Step<Run> {
    Step::new("Stage preview build context").run(indoc::indoc! {r#"
        set -euo pipefail
        # The dev-shell env (BASH_ENV) exports a Nix LD_LIBRARY_PATH; host
        # binaries like rsync then resolve Nix-store libs whose deps drag in
        # Nix glibc mid-process and crash on glibc symbol versions. This step
        # is pure file shuffling — drop it.
        unset LD_LIBRARY_PATH
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
        # build intermediates. `-p` everywhere: preserved mtimes mean files
        # cargo didn't relink produce byte-identical Docker layers, so the
        # registry push/pull skips them (the Dockerfile orders its COPYs
        # stable → volatile for the same reason).
        find rust/cloud-storage/target/x86_64-unknown-linux-gnu/debug \
          -maxdepth 1 -type f -executable ! -name '*.d' ! -name '*.so' \
          -exec cp -p {} "$ctx/artifacts/binaries/" \;
        cp -a js/app/packages/app/dist "$ctx/artifacts/frontend-dist"
        # Only the current key's snapshot — the volume store accumulates keys.
        snap_dir=$(jq -r '.dir' "$RUNNER_TEMP/preview-snapshot.json")
        mkdir -p "$ctx/artifacts/snapshots"
        cp -a "$snap_dir" "$ctx/artifacts/snapshots/"
        cp -p rust/cloud-storage/target/x86_64-unknown-linux-gnu/release/xtask_local "$ctx/bin/xtask"
        cp -p infra/preview/entrypoint.sh "$ctx/entrypoint.sh"
        cp -p infra/preview/Dockerfile "$ctx/Dockerfile"
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
/// boot), mirror the stack images into the app's registry repo, then push the
/// slim VM image and deploy.
fn deploy_to_fly() -> Step<Run> {
    Step::new("Deploy to Fly")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            if [ -z "$DOPPLER_PREVIEW_TOKEN" ]; then
              echo "DOPPLER_PREVIEW_TOKEN secret is not set (a Doppler service token scoped to the preview config)" >&2
              exit 1
            fi
            if [ -z "$FLY_ORG" ]; then
              echo "FLY_ORG is not set (repo variable or secret with the Fly org slug)" >&2
              exit 1
            fi
            # `|| true`: the create fails once the app exists; real failures
            # (auth, org) surface on the very next flyctl call.
            flyctl apps create "$APP_NAME" --org "$FLY_ORG" || true
            # A read-only, app-scoped, time-boxed pull token so the machine's
            # inner dockerd can pull the mirrored stack images from this app's
            # registry repo — and nothing else (PR code can read machine
            # secrets, so scope matters). The org deploy token can't mint new
            # tokens (createLimitedAccessToken is not authorized), but macaroon
            # attenuation is pure client-side crypto: append an Apps caveat
            # (numeric app id, mask "r") and a validity window to our own token.
            app_id=$(curl -sf https://api.fly.io/graphql \
              -H "Authorization: Bearer $FLY_API_TOKEN" \
              -H "content-type: application/json" \
              -d "{\"query\":\"{ app(name: \\\"$APP_NAME\\\") { internalNumericId } }\"}" \
              | jq -re '.data.app.internalNumericId')
            now=$(date +%s)
            pull_token=$(printf '[{"type":"Apps","body":{"apps":{"%s":"r"}}},{"type":"ValidityWindow","body":{"not_before":%d,"not_after":%d}}]' \
              "$app_id" $((now - 60)) $((now + 604800)) | flyctl tokens attenuate)
            flyctl secrets set --app "$APP_NAME" --stage \
              "DOPPLER_TOKEN=$DOPPLER_PREVIEW_TOKEN" \
              "REGISTRY_PULL_TOKEN=$pull_token"
            # The volume behind fly.toml's /var/lib/docker mount (see the
            # comment there). `volumes create` is not idempotent — guard it.
            if ! flyctl volumes list --app "$APP_NAME" --json \
                 | jq -e 'map(select(.name == "docker_data")) | length > 0' >/dev/null; then
              flyctl volumes create docker_data --app "$APP_NAME" --region ewr --size 40 --yes
            fi
            # Machines created before the volume existed can't take the
            # [mounts] config update — recreate them.
            flyctl machine list --app "$APP_NAME" --json \
              | jq -r '.[] | select((.config.mounts // []) | length == 0) | .id' \
              | while read -r id; do
                  [ -z "$id" ] || flyctl machine destroy "$id" --app "$APP_NAME" --force || true
                done
            flyctl auth docker
            registry="registry.fly.io/$APP_NAME"
            # Mirror every stack image into the app's registry repo instead of
            # baking docker-save tars into the VM image (which made every
            # deploy re-ship ~5GB the machine's volume already had). Pushes
            # dedup at the layer level against the repo, so a redeploy only
            # uploads layers that actually changed; the entrypoint pulls with
            # the same dedup against the machine's persistent layer store. The
            # manifest maps image ID -> local tag -> registry ref so boots can
            # skip images already present. alpine:3 rides along for the
            # snapshot-restore helper container.
            # On a snapshot cache hit only gen-compose ran, which doesn't write
            # the env file; compose hard-fails on a missing --env-file, and the
            # image names don't interpolate env vars anyway.
            envfile=infra/local/generated/macro/local.generated.env
            [ -f "$envfile" ] || : > "$envfile"
            images=$(docker compose -p macro \
              -f docker-compose.yml \
              -f infra/local/generated/macro/docker-compose.override.yml \
              --env-file "$envfile" \
              config --images | sort -u)
            echo "mirroring images:" $images
            docker pull alpine:3
            mkdir -p preview-ctx/preload
            : > preview-ctx/preload/manifest.txt
            : > "$RUNNER_TEMP/push-refs.txt"
            for img in $images alpine:3; do
              # Images the bake didn't leave in the daemon (snapshot cache hit,
              # or app-layer-only images like proxy/mailpit) get pulled here.
              docker image inspect "$img" >/dev/null 2>&1 || docker pull "$img"
              id=$(docker image inspect -f '{{.Id}}' "$img")
              # Content-addressed tag: same image content = same ref, so a
              # redeploy's push is skippable by a manifest existence check and
              # concurrent PRs' deploys can never clobber each other's tags.
              ref="$registry:img-$(echo "$img" | tr '/:' '__')-$(echo "$id" | cut -c8-19)"
              docker tag "$img" "$ref"
              echo "$id $img $ref" >> preview-ctx/preload/manifest.txt
              if ! docker manifest inspect "$ref" >/dev/null 2>&1; then
                echo "$ref" >> "$RUNNER_TEMP/push-refs.txt"
              fi
            done
            echo "pushing $(wc -l < "$RUNNER_TEMP/push-refs.txt") of $(wc -l < preview-ctx/preload/manifest.txt) images"
            # The Fly registry occasionally aborts large uploads ("s3aws:
            # append to zero-size path unsupported") — retry; layers that made
            # it are reused. Four pushes at a time keeps the first (cold) push
            # moving without saturating the registry.
            if [ -s "$RUNNER_TEMP/push-refs.txt" ]; then
              xargs -P 4 -I {} sh -c '
                  for _ in 1 2 3; do
                    docker push "{}" && exit 0
                    echo "push of {} failed, retrying" >&2
                    sleep 15
                  done
                  exit 1' < "$RUNNER_TEMP/push-refs.txt"
            fi
            image="$registry:${{ github.sha }}"
            docker build -t "$image" preview-ctx
            pushed=""
            for _ in 1 2 3; do
              if docker push "$image"; then pushed=1; break; fi
              echo "docker push failed, retrying" >&2
              sleep 15
            done
            [ -n "$pushed" ]
            # Keep the machine in demand while it boots: with zero inbound
            # traffic, fly-proxy counts a health-failing machine as excess
            # capacity and suspends it mid-boot (observed mid-docker-load).
            # Any response status counts as traffic, and a request also
            # resumes an already-suspended machine.
            (while :; do
              curl -s -o /dev/null --max-time 10 "https://$APP_NAME.fly.dev/" || true
              sleep 15
            done) &
            keepalive=$!
            # First boot does real work before 8090 opens (pulling the stack
            # images, snapshot restore, compose up, FusionAuth's JVM) —
            # give the health check more runway than flyctl's default wait.
            rc=0
            flyctl deploy --app "$APP_NAME" \
              --config infra/preview/fly.toml \
              --image "$image" \
              --wait-timeout 1800 \
              --yes || rc=$?
            kill "$keepalive" 2>/dev/null || true
            exit "$rc"
        "#})
        // Accept the org slug from either a repo variable or a repo secret —
        // it's not sensitive, but people reasonably reach for secrets first.
        .add_env(("FLY_ORG", "${{ vars.FLY_ORG || secrets.FLY_ORG }}"))
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
