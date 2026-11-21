//! `Pulumi Preview on PR` — detects which cloud-storage services a PR touches
//! and fans out a pulumi preview per service via `reusable_preview_service`.
//! Generated into `pulumi_preview_pr.yml` (replaces the hand-written
//! `pulumi-preview-pr.yml`).

use gh_workflow::expr::typed::{
    Flag, JobHandle, JobOutput, Json, Num, StepHandle, StepOutput, Str, always, from_json, github,
    matrix,
};
use gh_workflow::{
    CallJob, Concurrency, Event, Job, Level, Permissions, PullRequest, Run, Step, Strategy, Use,
    Workflow, ZizmorRule,
};

use xtask_paths::RepoGlob;

use crate::workflows::actions::{
    ActionsCheckout, CallReusablePreviewService, TjActionsChangedFiles,
};
use crate::workflows::runners;

#[cfg(test)]
mod test;

pub(crate) struct DetectChangesOutputs {
    /// The affected services, as a JSON array.
    pub services: JobOutput<Str>,
    /// Whether any service is affected.
    pub has_changes: JobOutput<Flag>,
}

/// The job that finds the services a PR affects.
pub(crate) const DETECT_CHANGES: JobHandle<DetectChangesOutputs> = JobHandle::new(
    "detect-changes",
    DetectChangesOutputs {
        services: JobOutput::new("detect-changes", "services"),
        has_changes: JobOutput::new("detect-changes", "has-changes"),
    },
);

pub(crate) struct DetectOutputs {
    /// The affected services, as a JSON array.
    pub services: StepOutput<Str>,
    /// Whether any service is affected.
    pub has_changes: StepOutput<Flag>,
}

/// The step that writes [`DETECT_CHANGES`]'s outputs.
pub(crate) const DETECT: StepHandle<DetectOutputs> = StepHandle::new(
    "detect",
    DetectOutputs {
        services: StepOutput::new("detect", "services"),
        has_changes: StepOutput::new("detect", "has-changes"),
    },
);

/// The changed-files action, which writes the files [`DETECT`] reads.
pub(crate) const CHANGED_FILES: StepHandle<()> = StepHandle::new("changed-files", ());

pub(crate) const PREVIEW_SERVICES: JobHandle<()> = JobHandle::new("preview-services", ());

/// Inputs that can change a stack's definition. Crate and service code is left
/// out on purpose: its preview is always the same "Lambda code / image changed"
/// diff, and producing it costs a from-scratch Lambda build per stack.
const TRIGGER_PATHS: &[RepoGlob<'static>] = &[
    RepoGlob::new("infra/**"),
    // `infra/stacks/kafka-cluster` reads its topics from this generated file.
    RepoGlob::new(".github/kafka-cluster-topics.json"),
    RepoGlob::new(".github/services-config.json"),
    RepoGlob::new(".github/workflows/pulumi_preview_pr.yml"),
    RepoGlob::new(".github/workflows/reusable_preview_service.yml"),
    RepoGlob::new(".github/actions/preview-cloud-storage-pulumi/**"),
    RepoGlob::new(".github/actions/setup-nix/**"),
    RepoGlob::new(".github/actions/teardown-nix/**"),
    RepoGlob::new(".github/scripts/build-cloud-storage-lambdas-nix.sh"),
];

/// Build the workflow.
pub fn pulumi_preview_pr() -> Workflow {
    Workflow::new("Pulumi Preview on PR")
        .on(
            Event::default().pull_request(TRIGGER_PATHS.iter().copied().fold(
                PullRequest::default().add_branch("main"),
                PullRequest::add_path,
            )),
        )
        .concurrency(
            Concurrency::new(format!(
                "{}-{}",
                github().workflow(),
                github().event::<Num>("pull_request.number")
            ))
            .cancel_in_progress(true),
        )
        .permissions(
            Permissions::default()
                .contents(Level::Read)
                .pull_requests(Level::Write)
                .id_token(Level::Write),
        )
        .add_job(DETECT_CHANGES, detect_changes())
        .add_job(PREVIEW_SERVICES, preview_services())
        .add_job("preview-status", preview_status())
}

fn detect_changes() -> Job {
    Job::default()
        .name("Detect Changed Services")
        .runs_on(runners::Runner::Small.to_string())
        .add_output(
            DETECT_CHANGES.outputs.services.name(),
            DETECT.outputs.services.read(),
        )
        .add_output(
            DETECT_CHANGES.outputs.has_changes.name(),
            DETECT.outputs.has_changes.read(),
        )
        .add_step(checkout())
        .add_step(changed_files())
        .add_step(detect_affected_services())
}

fn preview_services() -> CallJob {
    CallReusablePreviewService::new("dev", matrix::<Str>("service"))
        .github_token(github().token())
        .inherit_secrets()
        .job()
        .name(format!("Preview {}", matrix::<Str>("service")))
        .needs(vec![DETECT_CHANGES.to_string()])
        .cond(DETECT_CHANGES.outputs.has_changes.read().is_set())
        .strategy(Strategy {
            fail_fast: Some(false),
            matrix: Some(serde_json::json!({
                "service": serde_json::Value::from(from_json::<Json>(
                    DETECT_CHANGES.outputs.services.read()
                )),
            })),
            max_parallel: None,
        })
}

fn preview_status() -> Job {
    Job::default()
        .name("Preview Status")
        .needs(vec![
            DETECT_CHANGES.to_string(),
            PREVIEW_SERVICES.to_string(),
        ])
        .cond(always())
        .runs_on(runners::Runner::Small.to_string())
        .add_step(summary())
}

fn checkout() -> Step<Use> {
    ActionsCheckout::new("Checkout Repo").step().zizmor_ignore(
        ZizmorRule::Artipacked,
        "Pulumi previews run from the checkout",
    )
}

fn changed_files() -> Step<Use> {
    TjActionsChangedFiles::new("Get changed files")
        .files(
            TRIGGER_PATHS
                .iter()
                .map(|path| path.as_str())
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .json(true)
        .escape_json(false)
        .write_output_files(true)
        .step()
        .id(CHANGED_FILES.id())
}

fn detect_affected_services() -> Step<Run> {
    Step::new("Detect affected services")
        .run(indoc::indoc! {r#"
            services=()

            # The action joins its plain-text output with spaces and no trailing
            # newline, which `while read` never yields a line from, so read the
            # JSON list and split it one path per line. `all_modified_files`,
            # unlike `all_changed_files`, includes deletions.
            changed_files=.github/outputs/changed_files.txt
            jq -r '.[]' .github/outputs/all_modified_files.json > "$changed_files"

            config=$(cat .github/services-config.json)

            # Shared infra code, root infra manifests, and the preview's own
            # machinery can change every stack.
            preview_all=false
            while IFS= read -r file; do
              if [[ "$file" == infra/packages/* || \
                    ( "$file" == infra/* && "${file#infra/}" != */* ) || \
                    "$file" == ".github/services-config.json" || \
                    "$file" == ".github/workflows/pulumi_preview_pr.yml" || \
                    "$file" == ".github/workflows/reusable_preview_service.yml" || \
                    "$file" == .github/actions/preview-cloud-storage-pulumi/* || \
                    "$file" == .github/actions/setup-nix/* || \
                    "$file" == .github/actions/teardown-nix/* || \
                    "$file" == ".github/scripts/build-cloud-storage-lambdas-nix.sh" ]]; then
                preview_all=true
                break
              fi
            done < "$changed_files"

            for service in $(jq -r '.services | keys[]' <<< "$config"); do
              bootstrap_pending=$(jq -r --arg s "$service" '.services[$s].bootstrap_pending // empty' <<< "$config")
              if jq -e --arg s "$service" '.services[$s].bootstrap_pending != null' <<< "$config" > /dev/null; then
                echo "::notice::Deferring $service live infrastructure checks: $bootstrap_pending"
                continue
              fi
              service_changed=$preview_all

              stack_path=$(jq -r --arg s "$service" '.services[$s].stack_path // empty' <<< "$config")
              if [[ "$service_changed" != "true" && -n "$stack_path" ]]; then
                while IFS= read -r file; do
                  if [[ "$file" == $stack_path ]]; then
                    service_changed=true
                    break
                  fi
                done < "$changed_files"
              fi

              # The kafka-cluster stack reads its topics from this generated file.
              if [[ "$service" == "kafka-cluster" ]] && \
                  grep -qxF .github/kafka-cluster-topics.json "$changed_files"; then
                service_changed=true
              fi

              if [[ "$service_changed" == "true" ]]; then
                services+=("$service")
              fi
            done

            # A stack directory no service's `stack_path` claims gets no preview.
            unmapped=$(sed -n 's|^infra/stacks/\([^/]*\)/.*|\1|p' "$changed_files" | sort -u |
              while IFS= read -r stack; do
                if ! jq -e --arg p "infra/stacks/$stack/**" \
                  'any(.services[]; .stack_path == $p)' <<< "$config" > /dev/null; then
                  echo "$stack"
                fi
              done)
            if [[ -n "$unmapped" ]]; then
              echo "::warning::No preview for infra/stacks/{$(paste -sd, <<< "$unmapped")}: no service in .github/services-config.json has that stack_path"
            fi

            if [ ${#services[@]} -eq 0 ]; then
              echo "has-changes=false" >> "$GITHUB_OUTPUT"
              echo "services=[]" >> "$GITHUB_OUTPUT"
              echo "No services affected by changes"
            else
              echo "has-changes=true" >> "$GITHUB_OUTPUT"
              services_json=$(printf '%s\n' "${services[@]}" | jq -R . | jq -s -c .)
              echo "services=${services_json}" >> "$GITHUB_OUTPUT"
              echo "Services to preview: ${services[*]}"
            fi
        "#})
        .id(DETECT.id())
}

fn summary() -> Step<Run> {
    Step::new("Summary")
        .run(indoc::indoc! {r#"
            if [[ "$HAS_CHANGES" == "false" ]]; then
              echo "ℹ️ No services were affected by the changes in this PR"
            elif [[ "$PREVIEW_SERVICES_RESULT" == "failure" ]]; then
              echo "❌ One or more Pulumi previews failed"
              exit 1
            elif [[ "$PREVIEW_SERVICES_RESULT" == "success" ]]; then
              echo "✅ All Pulumi previews completed successfully"
            elif [[ "$PREVIEW_SERVICES_RESULT" == "skipped" ]]; then
              echo "ℹ️ No services were affected by the changes in this PR"
            fi
        "#})
        .add_env(("HAS_CHANGES", DETECT_CHANGES.outputs.has_changes.read()))
        .add_env(("PREVIEW_SERVICES_RESULT", PREVIEW_SERVICES.result()))
}
