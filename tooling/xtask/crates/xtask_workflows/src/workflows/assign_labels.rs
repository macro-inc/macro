//! `Auto Label PRs` — applies coarse area labels from changed PR paths.

use gh_workflow::{Event, Job, Level, Permissions, PullRequest, PullRequestType, Step, Workflow};

use crate::workflows::{runners, steps};

/// Build the workflow.
pub fn assign_labels() -> Workflow {
    Workflow::new("Auto Label PRs")
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_type(PullRequestType::Opened)
                .add_type(PullRequestType::Synchronize)
                .add_type(PullRequestType::Reopened),
        ))
        .add_job("label", label_job())
}

fn label_job() -> Job {
    Job::default()
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .permissions(Permissions {
            contents: Some(Level::Read),
            pull_requests: Some(Level::Write),
            ..Default::default()
        })
        .add_step(steps::checkout(true, false))
        .add_step(changed_files())
        .add_step(label_by_paths())
}

fn changed_files() -> Step<gh_workflow::Use> {
    Step::new("Get changed files")
        .uses(
            "tj-actions",
            "changed-files",
            "24d32ffd492484c1d75e0c0b894501ddb9d30d62",
        )
        .id("changed-files")
        .add_with(("json", true))
        .add_with(("escape_json", false))
        .add_with(("write_output_files", true))
}

fn label_by_paths() -> Step<gh_workflow::Use> {
    Step::new("Label based on paths")
        .uses(
            "actions",
            "github-script",
            "f28e40c7f34bde8b3046d885e986cb6290c5673b",
        )
        .add_with(("github-token", "${{ secrets.GITHUB_TOKEN }}"))
        .add_with((
            "script",
            indoc::indoc! {r#"
                const fs = require('fs');
                const changedFiles = JSON.parse(
                  fs.readFileSync('.github/outputs/all_changed_files.json', 'utf8')
                );
                const labels = new Set();

                // Define path-to-label mappings
                const pathMappings = [
                  { path: 'crates/', label: 'cloud-storage' },
                  { path: 'services/', label: 'cloud-storage' },
                  { path: 'tooling/xtask/', label: 'cloud-storage' },
                  { path: 'Cargo.', label: 'cloud-storage' },
                  { path: 'rust-toolchain.toml', label: 'cloud-storage' },
                  { path: 'apps/web/', label: 'web-app' },
                  { path: 'packages/', label: 'web-app' },
                  { path: 'infra', label: 'infra' }
                ];

                // Check each changed file against path mappings
                for (const file of changedFiles) {
                  for (const mapping of pathMappings) {
                    if (file.startsWith(mapping.path)) {
                      labels.add(mapping.label);
                    }
                  }
                }

                // Add labels to the PR
                if (labels.size > 0) {
                  await github.rest.issues.addLabels({
                    owner: context.repo.owner,
                    repo: context.repo.repo,
                    issue_number: context.issue.number,
                    labels: Array.from(labels)
                  });

                  console.log(`Added labels: ${Array.from(labels).join(', ')}`);
                } else {
                  console.log('No matching labels found for changed files');
                }
            "#},
        ))
}
