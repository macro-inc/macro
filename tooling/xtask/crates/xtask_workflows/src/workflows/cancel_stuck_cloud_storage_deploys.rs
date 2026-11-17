//! `Cancel Stuck Cloud Storage Deploys` — hourly cron that cancels
//! `deploy_on_push` runs stuck queued/in_progress past a
//! threshold. Generated into `cancel_stuck_cloud_storage_deploys.yml`
//! (replaces the hand-written `cancel-stuck-cloud-storage-deploys.yml`).
//!
//! Runs on the tiny no-cache profile: it's a single `gh api` + `jq` script
//! (both ship in Namespace's runner base image), no checkout, no build.

use gh_workflow::expr::typed::{Str, github, input};
use gh_workflow::{
    Event, Job, Level, Permissions, Schedule, Step, Workflow, WorkflowDispatch, WorkflowInput,
};

use crate::workflows::runners;

/// Build the workflow.
pub fn cancel_stuck_cloud_storage_deploys() -> Workflow {
    Workflow::new("Cancel Stuck Cloud Storage Deploys")
        .on(Event::default()
            .add_schedule(Schedule::new("0 * * * *"))
            .workflow_dispatch(
                WorkflowDispatch::default()
                    .add_input(
                        "max-age-minutes",
                        WorkflowInput::string()
                            .description("Cancel active runs older than this many minutes")
                            .required(false)
                            .default("90"),
                    )
                    .add_input(
                        "dry-run",
                        WorkflowInput::boolean()
                            .description("Log what would be cancelled without doing it")
                            .required(false)
                            .default(false),
                    ),
            ))
        .permissions(
            Permissions::default()
                .actions(Level::Write)
                .contents(Level::Read),
        )
        .add_job("cancel-stuck", cancel_stuck())
}

fn cancel_stuck() -> Job {
    Job::default()
        .name("Cancel runs stuck queued or in_progress past threshold")
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .timeout_minutes(5u32)
        // Keep in sync with the deploy trigger's generated filename
        // (see deploy_on_push.rs).
        .add_env(("WORKFLOW_FILE", "deploy_on_push.yml"))
        // Both inputs are empty on the schedule, so each falls back to text.
        .add_env((
            "MAX_AGE_MINUTES",
            input::<Str>("max-age-minutes").or_else("90"),
        ))
        .add_env(("DRY_RUN", input::<Str>("dry-run").or_else("false")))
        .add_env(("GH_TOKEN", github().token()))
        .add_env(("GH_REPO", github().repository()))
        .add_step(cancel_runs())
}

fn cancel_runs() -> Step<gh_workflow::Run> {
    Step::new("Cancel runs older than threshold")
        .run(indoc::indoc! {r#"
            set -euo pipefail

            threshold_seconds=$(( MAX_AGE_MINUTES * 60 ))
            now=$(date -u +%s)

            mapfile -t stuck < <(
              gh api "repos/${GH_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=100" \
                | jq -r --argjson now "$now" --argjson threshold "$threshold_seconds" '
                    .workflow_runs[]
                    | select(.status == "queued" or .status == "in_progress")
                    | ($now - (.created_at | fromdateiso8601)) as $age
                    | select($age > $threshold)
                    | "\(.id)\t\($age)\t\(.html_url)"
                  '
            )

            if [[ ${#stuck[@]} -eq 0 ]]; then
              echo "No stuck runs found."
              exit 0
            fi

            echo "Found ${#stuck[@]} stuck run(s):"
            for row in "${stuck[@]}"; do
              IFS=$'\t' read -r run_id age url <<<"$row"
              age_min=$(( age / 60 ))
              echo "  run ${run_id} (age ${age_min}m): ${url}"
              if [[ "$DRY_RUN" == "true" ]]; then
                echo "    [dry-run] would cancel"
              else
                if gh api --method POST "repos/${GH_REPO}/actions/runs/${run_id}/cancel" >/dev/null 2>&1; then
                  echo "    cancelled"
                else
                  echo "    cancel failed (may have already completed)"
                fi
              fi
            done
        "#})
        .shell("bash")
}
