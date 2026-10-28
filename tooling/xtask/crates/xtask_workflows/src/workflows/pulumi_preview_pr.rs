//! `Pulumi Preview on PR` — detects which cloud-storage services a PR touches
//! and fans out a pulumi preview per service via `reusable_preview_service`.
//! Generated into `pulumi_preview_pr.yml` (replaces the hand-written
//! `pulumi-preview-pr.yml`).

use anyhow::Result;
use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, PullRequest, Run, Step, Strategy, Use,
    Workflow,
};

use xtask_paths::RepoGlob;

use crate::workflows::runners;

#[cfg(test)]
mod test;

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

/// Build the workflow. The reusable-workflow caller job's `with:` and
/// `secrets: inherit` are filled in by [`patch`].
pub fn pulumi_preview_pr() -> Workflow {
    Workflow::new("Pulumi Preview on PR")
        .on(
            Event::default().pull_request(TRIGGER_PATHS.iter().copied().fold(
                PullRequest::default().add_branch("main"),
                PullRequest::add_path,
            )),
        )
        .concurrency(
            Concurrency::new(Expression::new(
                "${{ github.workflow }}-${{ github.event.pull_request.number }}",
            ))
            .cancel_in_progress(true),
        )
        .permissions(
            Permissions::default()
                .contents(Level::Read)
                .pull_requests(Level::Write)
                .id_token(Level::Write),
        )
        .add_job("detect-changes", detect_changes())
        .add_job("preview-services", preview_services())
        .add_job("preview-status", preview_status())
}

/// Add what gh-workflow cannot express on the caller job, and drop the
/// `runs-on: ubuntu-latest` that `Job::default()` injects — a job that `uses`
/// a reusable workflow must not declare a runner.
pub fn patch(root: &mut serde_yaml::Value) -> Result<()> {
    let job = crate::workflows::job_mut(root, "preview-services")?;
    job.remove("runs-on");
    job.insert(
        "with".into(),
        crate::workflows::yaml_fragment(indoc::indoc! {r#"
            environment: dev
            service-name: ${{ matrix.service }}
            github-token: ${{ github.token }}
        "#})?,
    );
    job.insert("secrets".into(), "inherit".into());
    Ok(())
}

fn detect_changes() -> Job {
    Job::default()
        .name("Detect Changed Services")
        .runs_on(runners::Runner::Small.to_string())
        .add_output("services", "${{ steps.detect.outputs.services }}")
        .add_output("has-changes", "${{ steps.detect.outputs.has-changes }}")
        .add_step(checkout())
        .add_step(changed_files())
        .add_step(detect_affected_services())
}

fn preview_services() -> Job {
    Job::default()
        .name("Preview ${{ matrix.service }}")
        .needs(vec!["detect-changes".to_string()])
        .cond(Expression::new(
            "${{ needs.detect-changes.outputs.has-changes == 'true' }}",
        ))
        .strategy(Strategy {
            fail_fast: Some(false),
            matrix: Some(serde_json::json!({
                "service": "${{ fromJson(needs.detect-changes.outputs.services) }}",
            })),
            max_parallel: None,
        })
        .uses("./.github/workflows/reusable_preview_service.yml")
}

fn preview_status() -> Job {
    Job::default()
        .name("Preview Status")
        .needs(vec![
            "detect-changes".to_string(),
            "preview-services".to_string(),
        ])
        .cond(Expression::new("always()"))
        .runs_on(runners::Runner::Small.to_string())
        .add_step(summary())
}

fn checkout() -> Step<Use> {
    Step::new("Checkout Repo").uses(
        "actions",
        "checkout",
        "df4cb1c069e1874edd31b4311f1884172cec0e10",
    ) // v6
}

fn changed_files() -> Step<Use> {
    Step::new("Get changed files")
        .uses(
            "tj-actions",
            "changed-files",
            "24d32ffd492484c1d75e0c0b894501ddb9d30d62",
        ) // v47
        .id("changed-files")
        .add_with((
            "files",
            TRIGGER_PATHS
                .iter()
                .map(|path| path.as_str())
                .collect::<Vec<_>>()
                .join("\n"),
        ))
        .add_with(("json", true))
        .add_with(("escape_json", false))
        .add_with(("write_output_files", true))
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
              echo "has-changes=false" >> $GITHUB_OUTPUT
              echo "services=[]" >> $GITHUB_OUTPUT
              echo "No services affected by changes"
            else
              echo "has-changes=true" >> $GITHUB_OUTPUT
              services_json=$(printf '%s\n' "${services[@]}" | jq -R . | jq -s -c .)
              echo "services=${services_json}" >> $GITHUB_OUTPUT
              echo "Services to preview: ${services[@]}"
            fi
        "#})
        .id("detect")
}

fn summary() -> Step<Run> {
    Step::new("Summary").run(indoc::indoc! {r#"
        if [[ "${{ needs.detect-changes.outputs.has-changes }}" == "false" ]]; then
          echo "ℹ️ No services were affected by the changes in this PR"
        elif [[ "${{ needs.preview-services.result }}" == "failure" ]]; then
          echo "❌ One or more Pulumi previews failed"
          exit 1
        elif [[ "${{ needs.preview-services.result }}" == "success" ]]; then
          echo "✅ All Pulumi previews completed successfully"
        elif [[ "${{ needs.preview-services.result }}" == "skipped" ]]; then
          echo "ℹ️ No services were affected by the changes in this PR"
        fi
    "#})
}
