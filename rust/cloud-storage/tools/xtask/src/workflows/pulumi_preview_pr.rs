//! `Pulumi Preview on PR` — detects which cloud-storage services a PR touches
//! and fans out a pulumi preview per service via `reusable_preview_service`.
//! Generated into `pulumi_preview_pr.yml` (replaces the hand-written
//! `pulumi-preview-pr.yml`).

use anyhow::Result;
use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, PullRequest, Run, Step, Strategy, Use,
    Workflow,
};

use crate::workflows::runners;

/// Build the workflow. The reusable-workflow caller job's `with:` and
/// `secrets: inherit` are filled in by [`patch`].
pub fn pulumi_preview_pr() -> Workflow {
    Workflow::new("Pulumi Preview on PR")
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_branch("main")
                .add_path("rust/cloud-storage/**")
                .add_path(".github/workflows/pulumi_preview_pr.yml")
                .add_path(".github/workflows/reusable_preview_service.yml")
                .add_path(".github/actions/preview-cloud-storage-pulumi/**")
                .add_path(".github/services-config.json"),
        ))
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
            indoc::indoc! {r#"
                rust/cloud-storage/**
                .github/services-config.json
            "#}
            .trim_end(),
        ))
}

fn detect_affected_services() -> Step<Run> {
    Step::new("Detect affected services")
        .run(indoc::indoc! {r#"
            services=()

            # Read service config
            config=$(cat .github/services-config.json)

            # Check each service for changes
            for service in $(echo "$config" | jq -r '.services | keys[]'); do
              service_changed=false

              # Get paths for this service
              source_path=$(echo "$config" | jq -r --arg s "$service" '.services[$s].source_path // ""')
              stack_path=$(echo "$config" | jq -r --arg s "$service" '.services[$s].stack_path // ""')
              additional_paths=$(echo "$config" | jq -r --arg s "$service" '.services[$s].additional_paths[]? // ""')

              # Check if any changed files match service paths
              for file in ${{ steps.changed-files.outputs.all_changed_files }}; do
                if [[ -n "$source_path" && "$file" == $source_path ]]; then
                  service_changed=true
                elif [[ -n "$stack_path" && "$file" == $stack_path ]]; then
                  service_changed=true
                elif [[ -n "$additional_paths" ]]; then
                  for path in $additional_paths; do
                    if [[ "$file" == $path ]]; then
                      service_changed=true
                    fi
                  done
                fi
              done

              if [[ "$service_changed" == "true" ]]; then
                services+=("$service")
              fi
            done

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
