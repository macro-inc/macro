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

#[cfg(test)]
mod test;

/// Build the workflow. The reusable-workflow caller job's `with:` and
/// `secrets: inherit` are filled in by [`patch`].
pub fn pulumi_preview_pr() -> Workflow {
    Workflow::new("Pulumi Preview on PR")
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_branch("main")
                .add_path(xtask_paths::repo_glob!("Cargo.toml"))
                .add_path(xtask_paths::repo_glob!("Cargo.lock"))
                .add_path(xtask_paths::repo_glob!("Cross.toml"))
                .add_path(xtask_paths::repo_glob!("clippy.toml"))
                .add_path(xtask_paths::repo_glob!("rust-toolchain.toml"))
                .add_path(xtask_paths::repo_glob!(".cargo/**"))
                .add_path(xtask_paths::repo_glob!(".config/**"))
                .add_path(xtask_paths::repo_glob!(".sqlx/**"))
                .add_path(xtask_paths::repo_glob!("crates/**"))
                .add_path(xtask_paths::repo_glob!("services/**"))
                .add_path(xtask_paths::repo_glob!("tooling/just/**"))
                .add_path(xtask_paths::repo_glob!("static_assets/**"))
                .add_path(xtask_paths::repo_glob!("docker/**"))
                .add_path(xtask_paths::repo_glob!("flake.nix"))
                .add_path(xtask_paths::repo_glob!("flake.lock"))
                .add_path(xtask_paths::repo_glob!("nix/**"))
                .add_path(xtask_paths::repo_glob!("nix-support/**"))
                .add_path(xtask_paths::repo_glob!("infra/**"))
                .add_path(xtask_paths::repo_glob!(
                    ".github/workflows/pulumi_preview_pr.yml"
                ))
                .add_path(xtask_paths::repo_glob!(
                    ".github/workflows/reusable_preview_service.yml"
                ))
                .add_path(xtask_paths::repo_glob!(
                    ".github/actions/preview-cloud-storage-pulumi/**"
                ))
                .add_path(xtask_paths::repo_glob!(".github/actions/setup-nix/**"))
                .add_path(xtask_paths::repo_glob!(".github/actions/teardown-nix/**"))
                .add_path(xtask_paths::repo_glob!(
                    ".github/scripts/build-cloud-storage-lambdas-nix.sh"
                ))
                .add_path(xtask_paths::repo_glob!(".github/services-config.json"))
                .add_path(xtask_paths::repo_glob!(
                    ".github/workspace-dep-closures.json"
                )),
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
                Cargo.toml
                Cargo.lock
                Cross.toml
                clippy.toml
                rust-toolchain.toml
                .cargo/**
                .config/**
                .sqlx/**
                crates/**
                services/**
                tooling/just/**
                static_assets/**
                docker/**
                flake.nix
                flake.lock
                nix/**
                nix-support/**
                infra/**
                .github/workflows/pulumi_preview_pr.yml
                .github/workflows/reusable_preview_service.yml
                .github/actions/preview-cloud-storage-pulumi/**
                .github/actions/setup-nix/**
                .github/actions/teardown-nix/**
                .github/scripts/build-cloud-storage-lambdas-nix.sh
                .github/services-config.json
                .github/workspace-dep-closures.json
            "#}
            .trim_end(),
        ))
        .add_with(("write_output_files", true))
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

              # Workspace/build-system changes can affect every deployable.
              # `.sqlx/` lives at the repo root, so a snapshot-only edit would
              # otherwise match no service path or dependency-closure entry.
              # A crate source edit is not in this list: those preview only the
              # services whose deploy binaries depend on the crate.
              while IFS= read -r file; do
                if [[ "$file" == "Cargo.toml" || "$file" == "Cargo.lock" || \
                      "$file" == "Cross.toml" || \
                      "$file" == "rust-toolchain.toml" || "$file" == .cargo/* || \
                      "$file" == .config/* || "$file" == .sqlx/* || \
                      "$file" == tooling/just/* || "$file" == static_assets/* || \
                      "$file" == docker/* || "$file" == "flake.nix" || \
                      "$file" == "flake.lock" || "$file" == nix/* || \
                      "$file" == nix-support/* || "$file" == infra/packages/* ]]; then
                  service_changed=true
                  break
                fi
                # Root infra manifests/configuration are shared by every stack.
                if [[ "$file" == infra/* && "${file#infra/}" != */* ]]; then
                  service_changed=true
                  break
                fi
                if [[ "$file" == ".github/services-config.json" || \
                      "$file" == ".github/workflows/pulumi_preview_pr.yml" || \
                      "$file" == ".github/workflows/reusable_preview_service.yml" || \
                      "$file" == .github/actions/preview-cloud-storage-pulumi/* || \
                      "$file" == .github/actions/setup-nix/* || \
                      "$file" == .github/actions/teardown-nix/* || \
                      "$file" == ".github/scripts/build-cloud-storage-lambdas-nix.sh" || \
                      "$file" == ".github/workspace-dep-closures.json" ]]; then
                  service_changed=true
                  break
                fi
              done < .github/outputs/all_changed_files.txt

              # Get all source and stack globs for this service.
              service_paths=$(echo "$config" | jq -r --arg s "$service" \
                '(.services[$s].source_paths // [])[], (.services[$s].stack_path // empty)')

              # Check if any changed files match service paths. The action writes
              # the list to disk so very large PRs cannot exceed the runner's
              # environment/argument-size limit.
              if [[ "$service_changed" != "true" ]]; then
                while IFS= read -r file; do
                  while IFS= read -r path; do
                    if [[ -n "$path" && "$file" == $path ]]; then
                      service_changed=true
                      break 2
                    fi
                  done <<< "$service_paths"
                done < .github/outputs/all_changed_files.txt
              fi

              # Match crate/service source against each deployable's workspace
              # dependency closure so `crates/foo` previews foo's consumers, not
              # every stack. Binary names that are not package names are mapped
              # onto the crate that contains them.
              if [[ "$service_changed" != "true" ]]; then
                crates=$(echo "$config" | jq -r --arg s "$service" '
                  [(.services[$s].deploy_binaries // [])[], (.services[$s].deploy_lambdas // [])[]]
                  | map(
                      if . == "connection_gateway_service" then "connection_gateway"
                      elif . == "service" then "scheduled_action"
                      elif . == "pubsub_workers" then "email_service"
                      else . end
                    )
                  | unique | .[]
                ')
                while IFS= read -r crate; do
                  [[ -z "$crate" ]] && continue
                  while IFS= read -r dir; do
                    [[ -z "$dir" ]] && continue
                    while IFS= read -r file; do
                      if [[ "$file" == "$dir" || "$file" == "$dir"/* ]]; then
                        service_changed=true
                        break 3
                      fi
                    done < .github/outputs/all_changed_files.txt
                  done < <(jq -r --arg c "$crate" '.closures[$c] // empty | .[]' .github/workspace-dep-closures.json)
                done <<< "$crates"
              fi

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
