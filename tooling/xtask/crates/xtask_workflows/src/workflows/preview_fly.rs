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
//! inside the VM image. A brand-new PR's volume is forked from the newest
//! template volume on `macro-preview-template` (a warm layer store published
//! by a previous successful deploy, content-addressed by the image
//! manifest), so first boots pull only deltas instead of ~6GB cold. Runtime
//! secrets reach the machine as a config-scoped Doppler service token
//! (`DOPPLER_PREVIEW_TOKEN` → Fly secret `DOPPLER_TOKEN`), which the
//! stack's env layer pulls at boot.
//!
//! NOTE: never a required status check — previews are opt-in by design.

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, PullRequest, PullRequestType, Run,
    Step, Use, Workflow,
};

use crate::workflows::{runners, steps, vars};

/// The per-PR Fly app name; also the preview hostname (`<app>.fly.dev`).
const APP_NAME: &str = "macro-pr-${{ github.event.pull_request.number }}";

/// The app holding template volumes: warm /var/lib/docker layer stores that
/// new PR apps fork instead of pulling ~6GB of images onto an empty volume.
/// Machine-less — it exists purely as a volume namespace. Templates are
/// published by successful deploys and content-addressed by the preload
/// manifest, so nothing runs when the image set hasn't changed.
const TEMPLATE_APP: &str = "macro-preview-template";

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
        // linux-mid for the extra cores: five build lanes (zigbuild, compose
        // image builds, frontend, snapshot bake) genuinely contend on the
        // 8-core rust-ci shape. The cache volume follows the explicit tag,
        // not the profile, so this keeps the dedicated preview pool (nix
        // store + cargo target + snapshots) it has always used: see
        // PREVIEW_CACHE_TAG for why sharing the check/test jobs' pool was
        // measured cold on both layers (different --target = disjoint
        // sccache keys, and their volumes never carry a cargo target dir).
        .runs_on(runners::Runner::Mid.with_cache_tag(vars::PREVIEW_CACHE_TAG))
        // Backstop against hangs: worst honest case is ~15 min cold builds +
        // ~6 min cold mirror push + the 30 min flyctl wait cap. Anything past
        // an hour is a stuck step, not a slow deploy (a hung log fetch once
        // burned 2h26m of runner before someone cancelled it by hand).
        .timeout_minutes(60u32)
        .permissions(
            Permissions::default()
                .contents(Level::Read)
                .pull_requests(Level::Write),
        )
        .add_env(("FLY_API_TOKEN", vars::FLY_API_TOKEN))
        .add_env(("APP_NAME", APP_NAME))
        .add_env(("TEMPLATE_APP", TEMPLATE_APP))
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
        .add_step(
            Step::new("Prune stale incremental caches")
                .run("rm -rf target/*/debug/incremental target/debug/incremental"),
        )
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
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup dev shell + web deps", false))
        .add_step(steps::configure_namespace_sccache(
            vars::PREVIEW_SCCACHE_NAME,
        ))
        .add_step(setup_flyctl())
        .add_step(build_artifacts())
        .add_step(dump_stack_diagnostics())
        .add_step(stage_context())
        .add_step(deploy_to_fly())
        .add_step(dump_fly_diagnostics())
        .add_step(dump_boot_timings())
        .add_step(publish_template_volume())
        .add_step(comment_preview_url())
}

/// When the machine never passes its health check, the answer is inside the
/// VM (dockerd, image load, `stack up`) — dump its logs and state so a failed
/// deploy is diagnosable from CI output alone.
fn dump_fly_diagnostics() -> Step<Run> {
    Step::new("Dump Fly diagnostics")
        .run(indoc::indoc! {r#"
            flyctl machine list --app "$APP_NAME" || true
            # `flyctl logs --no-tail` can hang forever on its NATS fetch
            # (observed: a healthy deploy stuck 1h53m in the timings dump) —
            # never call it without a timeout.
            timeout 60 flyctl logs --app "$APP_NAME" --no-tail || true
        "#})
        .if_condition(Expression::new("failure()"))
}

/// The entrypoint tees every boot-phase timing (image pulls, per-stage stack
/// up, auth startup) into a volume-backed file precisely so CI can read it
/// deterministically after a healthy deploy. `flyctl logs --no-tail` used to
/// serve this and both hung (unbounded NATS fetch) and silently lost the
/// early boot lines to Fly's short log retention. On a hot update the machine
/// never reboots, so the file describes the last real boot — the hot path's
/// own output already streams into the deploy step via `ssh console`.
fn dump_boot_timings() -> Step<Run> {
    Step::new("Dump boot timings").run(indoc::indoc! {r#"
        timeout 120 flyctl ssh console --app "$APP_NAME" --quiet \
          --command 'cat /var/lib/docker/.macro-preview/boot-timings.log' || true
    "#})
}

/// Every build artifact in one step, five lanes in parallel. The lanes are
/// independent by construction:
///
/// - `fly`: app create, template-volume fork kick, and pull-token mint —
///   nothing here needs build output, and the fork's ~2 min server-side
///   hydration must start within seconds to finish inside the compose
///   build instead of gating machine creation.
/// - `cargo`: service binaries then xtask_local, sequential because they
///   share the workspace target dir (cargo's build-dir lock would serialize
///   them anyway). xtask_local deliberately WITHOUT the `local-stack`
///   feature (the VM restores the baked snapshot so it never provisions
///   Kafka; skipping rdkafka means no dynamically-linked librdkafka in the
///   VM) and via zigbuild, not a host build (the nix dev shell links the
///   /nix/store ELF interpreter, which doesn't exist in the VM image).
/// - `web`: the same-origin frontend bundle.
/// - `images`: the compose-built app images (the most fragile part of a
///   fresh bring-up — a broken Dockerfile still fails the step early via
///   fail-fast wait), then a best-effort premirror push to the app's Fly
///   registry so the network transfer overlaps the cargo lane instead of
///   serializing after it. The deploy step's mirror loop stays
///   authoritative: its manifest-existence check skips whatever was
///   premirrored here and pushes the rest (e.g. the bake-built runtime
///   image).
/// - `bake`: the init snapshot (see the lane script header for details),
///   under its own CARGO_TARGET_DIR so its host xtask build doesn't take
///   the workspace build-dir lock the cargo lane holds.
///
/// Lanes log to files and are dumped as collapsible groups afterwards;
/// `wait -n` fails the step on the first lane failure and kills the rest.
fn build_artifacts() -> Step<Run> {
    Step::new("Build artifacts (parallel lanes)")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            lanes="$RUNNER_TEMP/lanes"
            mkdir -p "$lanes"

            cat > "$lanes/cargo.sh" <<'LANE'
            set -euo pipefail
            cargo x zigbuild
            sccache --show-stats
            cargo zigbuild --release --target x86_64-unknown-linux-gnu.2.36 -p xtask_local
            LANE

            cat > "$lanes/web.sh" <<'LANE'
            set -euo pipefail
            cd apps/web
            export MODE=development NODE_ENV=production
            export VITE_LOCAL_SERVERS=ALL VITE_LOCAL_BACKEND_ORIGIN=same-origin
            bun run --bun build
            LANE

            # Instant lane: everything Fly-side that needs no build output.
            # The template fork must fire within seconds of the job starting —
            # its ~2 min server-side hydration then finishes inside the compose
            # build. (It previously sat after the premirror pushes, which put
            # it at the END of the build phase and re-gated the deploy.)
            # Entirely best-effort: everything in the fly lane (app create,
            # fork kick, token mint) has an authoritative fallback in the
            # deploy step, so a transient Fly API failure must not fail the
            # build. A child `bash -e` (not a `|| `-guarded function: errexit
            # is suppressed inside those) keeps its internal fail-fast so a
            # failed app_id fetch can't mint a garbage token.
            cat > "$lanes/fly.sh" <<'LANE'
            set -euo pipefail
            bash -euo pipefail "$(dirname "$0")/fly-prep.sh" \
              || echo "fly prep failed (non-fatal): the deploy step falls back" >&2
            LANE

            cat > "$lanes/fly-prep.sh" <<'LANE'
            flyctl status --app "$APP_NAME" >/dev/null 2>&1 \
              || flyctl apps create "$APP_NAME" --org "$FLY_ORG" \
              || flyctl status --app "$APP_NAME" >/dev/null
            # Kick the template-volume fork (see the deploy step's
            # volume-state block, which stays the authoritative fallback).
            if ! flyctl volumes list --app "$APP_NAME" --json 2>/dev/null \
                 | jq -e 'map(select(.name == "docker_data")) | length > 0' >/dev/null; then
              tpl_src=$(flyctl volumes list --app "$TEMPLATE_APP" --json 2>/dev/null \
                | jq -r '[.[] | select((.name | startswith("tpl")) and .state == "created" and .attached_machine_id == null)]
                         | sort_by(.created_at) | last | .id // empty' 2>/dev/null) || tpl_src=
              if [ -n "$tpl_src" ]; then
                curl -sf -X POST "https://api.machines.dev/v1/apps/$APP_NAME/volumes" \
                  -H "Authorization: Bearer $FLY_API_TOKEN" \
                  -H "Content-Type: application/json" \
                  -d "{\"name\":\"docker_data\",\"region\":\"ewr\",\"source_volume_id\":\"$tpl_src\"}" \
                  | jq -r '"early template fork: \(.id // "failed") (\(.state // "-"))"' \
                  || echo "early template fork failed; deploy step will fall back" >&2
              fi
            fi
            # Mint the machine's app-scoped read-only registry pull token
            # (macaroon attenuation, see the deploy step for the why) so the
            # deploy preamble doesn't pay the round-trips serially.
            app_id=$(curl -sf https://api.fly.io/graphql \
              -H "Authorization: Bearer $FLY_API_TOKEN" \
              -H "content-type: application/json" \
              -d "{\"query\":\"{ app(name: \\\"$APP_NAME\\\") { internalNumericId } }\"}" \
              | jq -re '.data.app.internalNumericId')
            now=$(date +%s)
            printf '[{"type":"Apps","body":{"apps":{"%s":"r"}}},{"type":"ValidityWindow","body":{"not_before":%d,"not_after":%d}}]' \
              "$app_id" $((now - 60)) $((now + 604800)) \
              | flyctl tokens attenuate > "$RUNNER_TEMP/registry-pull-token.next"
            chmod 600 "$RUNNER_TEMP/registry-pull-token.next"
            mv "$RUNNER_TEMP/registry-pull-token.next" "$RUNNER_TEMP/registry-pull-token"
            LANE

            cat > "$lanes/images.sh" <<'LANE'
            set -euo pipefail
            docker compose --project-directory . -p macro -f docker/docker-compose.yml build \
              search sync_service websocket_service lexical_service ai_editing_worker
            # The image BUILD above is fatal; the premirror below is a pure
            # optimization with an authoritative fallback (the deploy step's
            # mirror loop), so its failure only costs a slower push later.
            bash -euo pipefail "$(dirname "$0")/premirror.sh" \
              || echo "premirror failed (non-fatal): the deploy step mirrors authoritatively" >&2
            LANE

            # Premirror: content-addressed refs, identical scheme to the deploy
            # step's mirror loop, so its manifest-existence check skips these.
            # Best effort by design — anything skipped here (images only the
            # bake produces, like macro-local-runtime:dev) is pushed there.
            # The fly lane created the app long ago; the guard is a fallback.
            cat > "$lanes/premirror.sh" <<'LANE'
            flyctl status --app "$APP_NAME" >/dev/null 2>&1 \
              || flyctl apps create "$APP_NAME" --org "$FLY_ORG" \
              || flyctl status --app "$APP_NAME" >/dev/null
            flyctl auth docker
            registry="registry.fly.io/$APP_NAME"
            for img in $(docker compose --project-directory . -p macro \
                -f docker/docker-compose.yml config --images | sort -u) alpine:3; do
              if ! docker image inspect "$img" >/dev/null 2>&1 && ! docker pull "$img"; then
                echo "premirror: skipping $img (not local, not pullable)"
                continue
              fi
              id=$(docker image inspect -f '{{.Id}}' "$img")
              ref="$registry:img-$(echo "$img" | tr '/:' '__')-$(echo "$id" | cut -c8-19)"
              docker tag "$img" "$ref"
              if ! docker manifest inspect "$ref" >/dev/null 2>&1; then
                for _ in 1 2 3; do
                  docker push "$ref" && break
                  echo "premirror push of $ref failed, retrying" >&2
                  sleep 15
                done
              fi
            done
            LANE

            # A cold `stack up --infra-only` runs the real init (migrate,
            # kickstart, Kafka topics, indices) and saves the content-addressed
            # snapshot the VM restores from. Infra only: the app services need
            # the Doppler-sourced env to boot, which this runner deliberately
            # lacks — the snapshot captures only the infra volumes anyway. Via
            # `just` (not the bare `cargo x` alias) because the justfile
            # enables the `local-stack` feature the Kafka provisioning needs.
            # The store lives on the cache volume for a zero-copy hit; every
            # snapshot is also stored as one tar in Namespace artifact storage
            # keyed by the same hash, so cache-volume onboarding misses
            # download the exact snapshot instead of paying for a full init.
            # Artifact access is an optimization: failures fall back to the
            # volume/cold-bake behavior. The final `snapshot --json` line lands
            # in $RUNNER_TEMP for the stage step.
            cat > "$lanes/bake.sh" <<'LANE'
            set -euo pipefail
            export CARGO_TARGET_DIR="$PWD/target/bake"
            mkdir -p "$MACRO_STACK_SNAPSHOT_DIR"
            status=$(just stack snapshot --json | tail -n 1)
            key=$(echo "$status" | jq -r '.key')
            root=$(echo "$status" | jq -r '.root')
            artifact="macro-preview/init-snapshots/${key}.tar"
            archive="$RUNNER_TEMP/init-snapshot-${key}.tar"
            artifact_hit=

            # The Namespace cache-volume pool has an onboarding period where a
            # runner can receive an empty fork. Artifact storage is the durable
            # fallback: restore into a temporary directory and only publish it to
            # the live store after validating the embedded manifest through xtask.
            if ! echo "$status" | jq -e '.present' >/dev/null; then
              restored="$RUNNER_TEMP/restored-init-snapshot"
              rm -rf "$restored"
              mkdir -p "$restored"
              if nsc artifact download "$artifact" "$archive" \
                      && tar -xf "$archive" -C "$restored" \
                  && [ -f "$restored/$key/manifest.json" ]; then
                rm -rf "$root/$key"
                cp -a "$restored/$key" "$root/$key"
                status=$(just stack snapshot --json | tail -n 1)
                if echo "$status" | jq -e '.present' >/dev/null; then
                  artifact_hit=1
                  echo "init snapshot artifact hit: $status"
                else
                  rm -rf "$root/$key"
                  echo "downloaded init snapshot failed validation; baking cold" >&2
                fi
              else
                echo "init snapshot artifact miss; baking cold" >&2
              fi
            fi

            if echo "$status" | jq -e '.present' >/dev/null; then
              echo "init snapshot cache hit: $status"
              cargo run --quiet --manifest-path Cargo.toml \
                -p xtask_local --features local-stack -- gen-compose
              # The cold path builds the runtime image inside `stack up`; on a
              # hit nothing else does, and the registry mirror needs it in the
              # local daemon (its pull fallback only covers public images —
              # macro-local-runtime:dev is not on Docker Hub).
              cargo run --quiet --manifest-path Cargo.toml \
                -p xtask_local --features local-stack -- runtime-image
            else
              just stack up --infra-only --no-doppler --no-build
              status=$(just stack snapshot --json | tail -n 1)
              echo "$status" | jq -e '.present' >/dev/null
            fi

            # Seed artifact storage from either a volume hit or a cold bake. Avoid
            # uploading another version when the artifact already exists; a race
            # between concurrent PRs is harmless and must not fail the preview.
            if [ -z "$artifact_hit" ] && ! nsc artifact describe "$artifact" >/dev/null 2>&1; then
              snap_dir=$(echo "$status" | jq -r '.dir')
              tar -cf "$archive" -C "$root" "$(basename "$snap_dir")"
              nsc artifact upload "$archive" "$artifact" --expires_in 720h \
                || echo "warning: failed to upload init snapshot artifact" >&2
            fi
            echo "$status" > "$RUNNER_TEMP/preview-snapshot.json"
            LANE

            declare -a pids=() names=()
            for name in fly cargo web images bake; do
              # setsid: each lane leads its own process group so fail-fast
              # can kill the whole tree (cargo/docker/bun children), not just
              # the wrapper shell.
              setsid bash "$lanes/$name.sh" > "$lanes/$name.log" 2>&1 &
              pids+=($!)
              names+=("$name")
            done
            fail=
            for _ in "${pids[@]}"; do
              # Bare `wait -n`: any child; explicit pids would error once a
              # job has already been reaped.
              if ! wait -n; then
                fail=1
                break
              fi
            done
            if [ -n "$fail" ]; then
              # Negative pids: signal each lane's whole process group.
              kill -- "${pids[@]/#/-}" 2>/dev/null || true
              wait || true
            fi
            for i in "${!names[@]}"; do
              echo "::group::lane: ${names[$i]}"
              cat "$lanes/${names[$i]}.log" || true
              echo "::endgroup::"
            done
            if [ -n "$fail" ]; then
              echo "a build lane failed (first failure aborts the rest); see lane logs above" >&2
              exit 1
            fi
    "#})
        .add_env(("FLY_ORG", "${{ vars.FLY_ORG || secrets.FLY_ORG }}"))
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
        rm -rf "$ctx"
        mkdir -p "$ctx/repo" "$ctx/artifacts/binaries" "$ctx/bin"
        # The minimal repo layout xtask reads at runtime — including every
        # snapshot-key input, byte-identical to this checkout, so the VM's
        # key matches the snapshot baked above.
        rsync -a --relative --exclude node_modules \
          docker/docker-compose.yml \
          docker/docker-compose-databases.yml \
          infra/stacks/fusionauth-instance/docker-compose.yml \
          infra/local/nginx \
          infra/local/opensearch \
          infra/stacks/opensearch/helpers \
          crates/macro_db_client/migrations \
          "$ctx/repo/"
        # Service binaries only — the target dir also holds gigabytes of
        # build intermediates. `-p` everywhere: preserved mtimes mean files
        # cargo didn't relink produce byte-identical Docker layers, so the
        # registry push/pull skips them (the Dockerfile orders its COPYs
        # stable → volatile for the same reason).
        find target/x86_64-unknown-linux-gnu/debug \
          -maxdepth 1 -type f -executable ! -name '*.d' ! -name '*.so' \
          -exec cp -p {} "$ctx/artifacts/binaries/" \;
        cp -a apps/web/dist "$ctx/artifacts/frontend-dist"
        # Only the current key's snapshot — the volume store accumulates keys.
        snap_dir=$(jq -r '.dir' "$RUNNER_TEMP/preview-snapshot.json")
        mkdir -p "$ctx/artifacts/snapshots"
        cp -a "$snap_dir" "$ctx/artifacts/snapshots/"
        snapshot_key=$(jq -r '.key' "$RUNNER_TEMP/preview-snapshot.json")
        runtime_key=$(cd "$ctx/repo" \
          && find . -type f -print0 \
          | sort -z \
          | xargs -0 sha256sum \
          | sha256sum \
          | cut -d ' ' -f 1)
        frontend_key=$(cd "$ctx/artifacts/frontend-dist" \
          && find . -type f -print0 \
          | sort -z \
          | xargs -0 sha256sum \
          | sha256sum \
          | cut -d ' ' -f 1)
        jq -n \
          --arg snapshot_key "$snapshot_key" \
          --arg runtime_key "$runtime_key" \
          --arg frontend_key "$frontend_key" \
          --arg commit "${{ github.sha }}" \
          '{format: 1, snapshot_key: $snapshot_key, runtime_key: $runtime_key, frontend_key: $frontend_key, commit: $commit}' \
          > "$ctx/deployment.json"
        cp -p target/x86_64-unknown-linux-gnu/release/xtask_local "$ctx/bin/xtask"
        cp -p infra/preview/hot-update.sh "$ctx/bin/hot-update"
        cp -p infra/preview/entrypoint.sh "$ctx/entrypoint.sh"
        cp -p infra/preview/Dockerfile "$ctx/Dockerfile"
        cp -p infra/preview/update.Dockerfile "$ctx/update.Dockerfile"
    "#})
}

fn setup_flyctl() -> Step<Use> {
    Step::new("Setup flyctl").uses(
        "superfly",
        "flyctl-actions/setup-flyctl",
        "ed8efb33836e8b2096c7fd3ba1c8afe303ebbff1",
    ) // 1.6
}

/// Select bootstrap / hot update / rehydrate from the running machine's durable
/// compatibility marker. All modes mirror content-addressed stack images. A
/// compatible machine pulls a scratch artifact carrier and applies it in place;
/// an absent, incompatible, or failed hot update falls through to the immutable
/// full-image deploy and snapshot restore.
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

            app_existed=
            if flyctl status --app "$APP_NAME" >/dev/null 2>&1; then
              app_existed=1
            else
              # A transient status error must not turn an existing app into a
              # hard create failure: create, then prove the app is reachable.
              flyctl apps create "$APP_NAME" --org "$FLY_ORG" \
                || flyctl status --app "$APP_NAME" >/dev/null
            fi

            # Seed a first boot's volume from the newest template volume — a
            # warm /var/lib/docker layer store published by a previous
            # successful deploy (see the "Publish template volume" step).
            # Measured cold, an empty volume costs ~11 min of image pulls at
            # boot. The images lane normally kicked the fork minutes ago (its
            # ~2 min server-side hydration overlaps the whole build phase);
            # this block is the authoritative fallback for a missing or
            # failed early fork. Cross-app forks need the Machines API:
            # flyctl resolves volume ids app-locally. The boot manifest check
            # makes the volume a pure cache, so every failure path here just
            # falls back to the old empty-volume behavior.
            vol_state=$(flyctl volumes list --app "$APP_NAME" --json 2>/dev/null \
              | jq -r '[.[] | select(.name == "docker_data")][0].state // empty') || vol_state=
            if [ -z "$vol_state" ]; then
              tpl_src=$(flyctl volumes list --app "$TEMPLATE_APP" --json 2>/dev/null \
                | jq -r '[.[] | select((.name | startswith("tpl")) and .state == "created" and .attached_machine_id == null)]
                         | sort_by(.created_at) | last | .id // empty' 2>/dev/null) || tpl_src=
              if [ -n "$tpl_src" ]; then
                vol_state=$(curl -sf -X POST "https://api.machines.dev/v1/apps/$APP_NAME/volumes" \
                  -H "Authorization: Bearer $FLY_API_TOKEN" \
                  -H "Content-Type: application/json" \
                  -d "{\"name\":\"docker_data\",\"region\":\"ewr\",\"source_volume_id\":\"$tpl_src\"}" \
                  | jq -r '.state // empty') || vol_state=
                if [ -n "$vol_state" ]; then
                  echo "seeding docker_data from template volume $tpl_src (state: $vol_state)"
                else
                  echo "template fork failed; falling back to an empty volume" >&2
                fi
              else
                echo "no template volume available; first boot will pull cold"
              fi
            fi

            # A read-only, app-scoped, time-boxed pull token so the machine's
            # inner dockerd can pull the mirrored stack images from this app's
            # registry repo — and nothing else (PR code can read machine
            # secrets, so scope matters). The org deploy token can't mint new
            # tokens (createLimitedAccessToken is not authorized), but macaroon
            # attenuation is pure client-side crypto: append an Apps caveat
            # (numeric app id, mask "r") and a validity window to our own
            # token. The images lane normally minted it already; fall back to
            # minting inline when its file is absent.
            if [ -s "$RUNNER_TEMP/registry-pull-token" ]; then
              pull_token=$(cat "$RUNNER_TEMP/registry-pull-token")
            else
              app_id=$(curl -sf https://api.fly.io/graphql \
                -H "Authorization: Bearer $FLY_API_TOKEN" \
                -H "content-type: application/json" \
                -d "{\"query\":\"{ app(name: \\\"$APP_NAME\\\") { internalNumericId } }\"}" \
                | jq -re '.data.app.internalNumericId')
              now=$(date +%s)
              pull_token=$(printf '[{"type":"Apps","body":{"apps":{"%s":"r"}}},{"type":"ValidityWindow","body":{"not_before":%d,"not_after":%d}}]' \
                "$app_id" $((now - 60)) $((now + 604800)) | flyctl tokens attenuate)
            fi

            snapshot_key=$(jq -r '.key' "$RUNNER_TEMP/preview-snapshot.json")
            runtime_key=$(jq -r '.runtime_key' preview-ctx/deployment.json)
            mode=bootstrap
            machine_id=
            if [ -n "$app_existed" ]; then
              mode=rehydrate
              machine_id=$(flyctl machine list --app "$APP_NAME" --json \
                | jq -r '[.[] | select((.config.mounts // []) | length > 0)][0].id // empty')
              if [ -n "$machine_id" ]; then
                # A suspended preview needs demand before SSH is reachable.
                curl -s -o /dev/null --max-time 10 "https://$APP_NAME.fly.dev/" || true
                for _ in $(seq 1 12); do
                  # `--command` is exec'd directly, NOT run through a shell —
                  # a bare `if [ -f ...` dies with `exec: "if": not found`, so
                  # the marker never parsed and every push silently rehydrated
                  # (~7 min) instead of going hot (~3 min). Hence the sh -c.
                  marker=$(flyctl ssh console --app "$APP_NAME" --machine "$machine_id" \
                    --quiet --command 'sh -c "if [ -f /var/lib/docker/.macro-preview/deployment.json ]; then cat /var/lib/docker/.macro-preview/deployment.json; else echo __NO_MARKER__; fi"' \
                    2>/dev/null || true)
                  if echo "$marker" | jq -e \
                      --arg key "$snapshot_key" \
                      --arg runtime "$runtime_key" \
                      '.format == 1 and .snapshot_key == $key and .runtime_key == $runtime and (.frontend_key | type == "string")' \
                      >/dev/null 2>&1; then
                    mode=hot
                    break
                  fi
                  # SSH succeeded and returned a marker (or proved it absent):
                  # incompatibility is real, not a wake-up race.
                  if [ "$marker" = __NO_MARKER__ ] \
                      || echo "$marker" | jq -e '.format != null' >/dev/null 2>&1; then
                    break
                  fi
                  sleep 5
                done
              fi
            fi
            echo "preview deployment mode: $mode (snapshot $snapshot_key)"

            # Keep the machine in demand for the WHOLE deploy, hot path
            # included: fly-proxy suspends a machine ~7 min after its last
            # proxied request, and SSH via hallpass is not proxy traffic — a
            # hot update with no browser traffic got its VM suspended
            # mid-session (the frozen `flyctl ssh console` then ate 52 min of
            # runner until the job timeout). Any response status counts as
            # traffic, and a request also resumes a suspended machine.
            (while :; do
              curl -s -o /dev/null --max-time 10 "https://$APP_NAME.fly.dev/" || true
              sleep 15
            done) &
            keepalive=$!
            trap 'kill "$keepalive" 2>/dev/null || true' EXIT

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
            images=$(docker compose --project-directory . -p macro \
              -f docker/docker-compose.yml \
              -f infra/local/generated/macro/docker-compose.override.yml \
              --env-file "$envfile" \
              config --images | sort -u)
            echo "mirroring images:" $images
            docker image inspect alpine:3 >/dev/null 2>&1 || docker pull alpine:3
            mkdir -p preview-ctx/preload
            : > preview-ctx/preload/manifest.txt
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
            done
            # The existence probes are pure network round-trips (and after the
            # premirror lane, almost all of them hit) — run them in parallel
            # instead of ~1s each serially.
            awk '{print $3}' preview-ctx/preload/manifest.txt \
              | xargs -P 8 -I {} sh -c \
                  'docker manifest inspect "{}" >/dev/null 2>&1 || echo "{}"' \
              > "$RUNNER_TEMP/push-refs.txt"
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

            push_image() {
              image_to_push=$1
              for _ in 1 2 3; do
                if docker push "$image_to_push"; then return 0; fi
                echo "docker push failed for $image_to_push, retrying" >&2
                sleep 15
              done
              return 1
            }

            if [ "$mode" = hot ]; then
              update_image="$registry:update-${{ github.sha }}"
              docker build -f preview-ctx/update.Dockerfile -t "$update_image" preview-ctx
              push_image "$update_image"
              token_file="$RUNNER_TEMP/registry-pull-token"
              printf '%s' "$pull_token" > "$token_file"
              chmod 600 "$token_file"
              hot_rc=0
              flyctl ssh sftp put "$token_file" /tmp/macro-registry-token \
                --app "$APP_NAME" --machine "$machine_id" --mode 0600 \
                || hot_rc=$?
              if [ "$hot_rc" = 0 ]; then
                # timeout backstop: a suspended-mid-session VM freezes the ssh
                # client forever (measured: 52 min of hang). 10 min is triple
                # a normal hot apply; on expiry we fall back to rehydrate.
                hot_command="/srv/macro/bin/hot-update '$update_image' /tmp/macro-registry-token"
                timeout 600 flyctl ssh console --app "$APP_NAME" --machine "$machine_id" \
                  --command "$hot_command" || hot_rc=$?
              fi
              if [ "$hot_rc" = 0 ]; then
                echo "hot update completed without restarting the Fly machine"
                exit 0
              fi
              echo "hot update failed (exit $hot_rc); falling back to full rehydrate" >&2
              mode=rehydrate
            fi

            # Bootstrap/rehydrate refreshes app secrets and reconciles the
            # persistent Docker volume before replacing the machine image.
            flyctl secrets set --app "$APP_NAME" --stage \
              "DOPPLER_TOKEN=$DOPPLER_PREVIEW_TOKEN" \
              "REGISTRY_PULL_TOKEN=$pull_token"
            if [ -z "$vol_state" ]; then
              # No volume and no fork landed (no template, or both fork
              # attempts failed): the old empty-volume path.
              flyctl volumes create docker_data --app "$APP_NAME" --region ewr --size 40 --yes
            elif [ "$vol_state" != created ]; then
              # A fork is still hydrating (usually already finished: the
              # images lane kicked it before the cargo lane even ended). The
              # volume must reach "created" before a machine can mount it; a
              # fork that never lands is replaced by an empty volume rather
              # than failing the deploy.
              for _ in $(seq 1 60); do
                vol_state=$(flyctl volumes list --app "$APP_NAME" --json \
                  | jq -r '[.[] | select(.name == "docker_data")][0].state // empty')
                [ "$vol_state" = created ] && break
                sleep 10
              done
              echo "seeded volume state: $vol_state"
              if [ "$vol_state" != created ]; then
                echo "template fork stuck (state: $vol_state); replacing with an empty volume" >&2
                vol_id=$(flyctl volumes list --app "$APP_NAME" --json \
                  | jq -r '[.[] | select(.name == "docker_data")][0].id // empty')
                [ -z "$vol_id" ] || flyctl volumes destroy "$vol_id" --app "$APP_NAME" --yes || true
                flyctl volumes create docker_data --app "$APP_NAME" --region ewr --size 40 --yes
              fi
            fi
            # Machines created before the volume existed can't take the mounts
            # config update. A destroyed/partial machine is recreated by deploy.
            flyctl machine list --app "$APP_NAME" --json \
              | jq -r '.[] | select((.config.mounts // []) | length == 0) | .id' \
              | while read -r id; do
                  [ -z "$id" ] || flyctl machine destroy "$id" --app "$APP_NAME" --force || true
                done

            image="$registry:${{ github.sha }}"
            docker build -t "$image" preview-ctx
            push_image "$image"
            # First boot does real work before 8090 opens (pulling the stack
            # images, snapshot restore, compose up, FusionAuth's JVM) —
            # give the health check more runway than flyctl's default wait.
            # The step-wide keepalive above holds the machine out of suspend.
            flyctl deploy --app "$APP_NAME" \
              --config infra/preview/fly.toml \
              --image "$image" \
              --wait-timeout 1800 \
              --yes
        "#})
        // Accept the org slug from either a repo variable or a repo secret —
        // it's not sensitive, but people reasonably reach for secrets first.
        .add_env(("FLY_ORG", "${{ vars.FLY_ORG || secrets.FLY_ORG }}"))
        .add_env(("DOPPLER_PREVIEW_TOKEN", vars::DOPPLER_PREVIEW_TOKEN))
}

/// After a healthy deploy this PR's volume is, by construction, a fully
/// warmed layer store for exactly the image set in the preload manifest
/// (bootstrap pulled it, hot-update reconciled it). Publish it as the
/// org-wide template that future first boots fork, content-addressed by the
/// manifest's (image id, tag) pairs — registry refs are excluded because
/// they embed the per-PR app name. An existing volume under the same key
/// means the image set is unchanged and nothing runs; there is no scheduled
/// refresh because the cache warms itself on exactly the deploys that
/// change it. Purely an optimization, hence continue-on-error: the boot
/// manifest check keeps forks of any template correct, stale or fresh.
fn publish_template_volume() -> Step<Run> {
    Step::new("Publish template volume")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            key=$(awk '{print $1, $2}' preview-ctx/preload/manifest.txt \
              | LC_ALL=C sort | sha256sum | cut -c1-24)
            vol_name="tpl$key"
            flyctl status --app "$TEMPLATE_APP" >/dev/null 2>&1 \
              || flyctl apps create "$TEMPLATE_APP" --org "$FLY_ORG"
            vols=$(flyctl volumes list --app "$TEMPLATE_APP" --json 2>/dev/null || echo '[]')
            if echo "$vols" | jq -e --arg n "$vol_name" \
                'map(select(.name == $n)) | length > 0' >/dev/null; then
              echo "template $vol_name already exists; image set unchanged"
            else
              src=$(flyctl volumes list --app "$APP_NAME" --json \
                | jq -r '[.[] | select(.name == "docker_data")][0].id // empty')
              if [ -n "$src" ]; then
                # Fire-and-forget: hydration is a server-side block copy;
                # nothing in this run depends on it finishing.
                curl -sf -X POST "https://api.machines.dev/v1/apps/$TEMPLATE_APP/volumes" \
                  -H "Authorization: Bearer $FLY_API_TOKEN" \
                  -H "Content-Type: application/json" \
                  -d "{\"name\":\"$vol_name\",\"region\":\"ewr\",\"source_volume_id\":\"$src\"}" \
                  | jq -r '"published \(.name) (\(.id), state: \(.state))"' \
                  || echo "template publish failed (non-fatal)" >&2
              fi
            fi
            # Prune superseded templates: keep the 3 newest, and never touch
            # anything younger than 2h — it may still be hydrating or serving
            # as a concurrent deploy's fork source.
            cutoff=$(date -u -d '2 hours ago' +%Y-%m-%dT%H:%M:%SZ)
            echo "$vols" | jq -r --arg cutoff "$cutoff" \
              '[.[] | select((.name | startswith("tpl")) and .attached_machine_id == null)]
               | sort_by(.created_at) | reverse | .[3:]
               | .[] | select(.created_at < $cutoff) | .id' \
              | while read -r old; do
                  [ -z "$old" ] || flyctl volumes destroy "$old" --app "$TEMPLATE_APP" --yes || true
                done
        "#})
        .add_env(("FLY_ORG", "${{ vars.FLY_ORG || secrets.FLY_ORG }}"))
        .continue_on_error(true)
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
