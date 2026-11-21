//! Export completed GitHub Actions attempts as workflow/job/step traces, and as
//! push, job and step events for percentiles over days.

use gh_workflow::expr::typed::{
    Bool, Expr, Flag, StepHandle, StepOutput, Str, always, github, runner,
};
use gh_workflow::{Event, Job, Level, Permissions, Step, Workflow, WorkflowRun, WorkflowRunType};

use crate::workflows::actions::{
    ActionsGithubScript, AwsActionsConfigureAwsCredentials,
    GrafanaGrafanaGithubActionsGhaOtelExport,
};
use crate::workflows::steps;

#[cfg(test)]
mod test;

// Explicit names avoid recursively observing this exporter. Add new workflows here.
// A push counts as finished when the last of its workflows has, and only a listed
// workflow's completion triggers the exporter, so every workflow a PR runs is either
// listed or in `UNOBSERVED_PR_WORKFLOWS`.
const OBSERVED_WORKFLOWS: &[&str] = &[
    "Android Play Release",
    "Android Release Drift",
    "Build Agent Daemon on Tag",
    "Build CEF with codecs",
    "Build AppImage",
    "Build Desktop on Tag",
    "Build Rust CI Image",
    "Build Web App",
    "Build macOS DMG",
    "CI Gate for Forks",
    "Cancel Stuck Cloud Storage Deploys",
    "Deploy AI Editing Worker",
    "Deploy All Services",
    "Deploy CLA Worker",
    "Deploy FusionAuth Instance",
    "Deploy Lexical Service",
    "Deploy Observability",
    "Deploy Production Release",
    "Deploy Service (Generic)",
    "Deploy Sync Service",
    "Deploy Web App",
    "Deploy Website",
    "Deploy analytics proxy dev",
    "Deploy on Push",
    "Ensure Daytona Snapshot",
    "Export Datadog observability definitions",
    "Migrate Macro Database",
    "Native Check Label",
    "PR CI",
    "Publish Android to Google Play",
    "Publish SDK",
    "Pulumi Preview on PR",
    "Push local stack binaries",
    "Release SDK",
    "Release Label Check",
    "Reusable Deploy Service",
    "Reusable Preview Service",
    "SDK Check",
    "Test macrod update",
    "Web App Pr Checks",
    "cargo deny advisories",
    "cargo deny check",
    "cargo workspace dependency check",
    "check generated workflows",
    "check node_modules nix",
    "check tauri lockfiles",
    "cloud storage code check",
    "conventions code check",
    "deploy pulumi service",
    "iOS App Store Publish",
    "iOS App Store Release",
    "iOS Preview",
    "iOS Release Drift",
    "infra code check",
];
// PR bookkeeping that runs on most PR events: labels, statuses, comments and text
// checks that take seconds, and preview cleanup when a PR closes. Exporting all of it
// used most of the repository's shared hourly API budget, so PR CI couldn't start.
// They seldom finish last on a push that ran PR CI (2 of about 640 in a week); such a
// push, and one where only these ran, gets no push line. A test checks every PR
// workflow is in one of the two lists.
#[cfg(test)]
const UNOBSERVED_PR_WORKFLOWS: &[&str] = &[
    "Auto Label PRs",
    "CI Gate Label Check",
    "CI Gate Reminder",
    "CLA",
    "Cleanup Preview",
    "PR Privacy Check",
    "Pull Request",
];
struct PreflightOutputs {
    /// Whether the preflight cleared the run for the trace exporter.
    export: StepOutput<Flag>,
}

const PREFLIGHT: StepHandle<PreflightOutputs> = StepHandle::new(
    "preflight",
    PreflightOutputs {
        export: StepOutput::new("preflight", "export"),
    },
);

struct IngestOutputs {
    /// The OTLP `Authorization` header for the ingestion endpoint.
    headers: StepOutput<Str>,
}

const INGEST: StepHandle<IngestOutputs> = StepHandle::new(
    "ingest",
    IngestOutputs {
        headers: StepOutput::new("ingest", "headers"),
    },
);

fn events_file() -> String {
    format!("{}/ci-telemetry-events.json", runner().temp())
}

fn jobs_file() -> String {
    format!("{}/ci-telemetry-jobs.json", runner().temp())
}

/// A run whose jobs were all skipped has no events and no trace worth a call.
fn ran() -> Expr<Bool> {
    github()
        .event::<Str>("workflow_run.conclusion")
        .ne("skipped")
}

/// Build the CI telemetry observer without checking out code or downloading artifacts.
pub fn export_ci_telemetry() -> Workflow {
    Workflow::new("Export CI telemetry")
        .on(Event::default().workflow_run(
            WorkflowRun::default()
                .add_type(WorkflowRunType::Completed)
                .workflows(
                    OBSERVED_WORKFLOWS
                        .iter()
                        .map(|name| (*name).to_owned())
                        .collect::<Vec<_>>(),
                ),
        ))
        .permissions(Permissions {
            contents: Some(Level::Read),
            actions: Some(Level::Read),
            pull_requests: Some(Level::Read),
            id_token: Some(Level::Write),
            ..Default::default()
        })
        .add_job("export", export())
}

fn export() -> Job {
    Job::default()
        // GitHub's hosted image supplies AWS CLI, Python and Node without a checkout/setup step.
        .runs_on("ubuntu-latest")
        .timeout_minutes(10u32)
        .cond(ran())
        // The only step that lists the run's jobs; it leaves them for the collector.
        .add_step(
            ActionsGithubScript::new(
                "Check API budget and upstream exporter limits",
                include_str!("scripts/ci_telemetry_preflight.js"),
            )
            .step()
            .id(PREFLIGHT.id())
            .add_env(("CI_TELEMETRY_JOBS", jobs_file())),
        )
        // Before any credential exists, so nothing the run produced shares a step with it.
        .add_step(
            Step::new("Collect push, job and step events")
                .run(steps::node_script(include_str!(
                    "scripts/ci_telemetry_collect.ts"
                )))
                .shell("bash")
                .if_condition(always())
                .continue_on_error(true)
                .timeout_minutes(2u32)
                .add_env(("GITHUB_TOKEN", github().token()))
                .add_env(("CI_TELEMETRY_JOBS", jobs_file()))
                .add_env(("CI_TELEMETRY_EVENTS", events_file())),
        )
        .add_step(
            AwsActionsConfigureAwsCredentials::new("Assume CI telemetry role", "us-east-1")
                .role_to_assume("arn:aws:iam::569036502058:role/macro-observability-ci")
                .role_duration_seconds(900)
                .step()
                .if_condition(always()),
        )
        .add_step(
            Step::new("Read ingestion credential")
                .run(include_str!("scripts/read_ci_ingestion_credential.sh"))
                .id(INGEST.id())
                .if_condition(always())
                .shell("bash"),
        )
        // Ahead of the traces: one failing must not cost the other, and this one is
        // the only record of a run the trace exporter refuses.
        .add_step(
            Step::new("Send push, job and step events")
                .run(steps::node_script(include_str!(
                    "scripts/ci_telemetry_send.ts"
                )))
                .shell("bash")
                .if_condition(always())
                .continue_on_error(true)
                .timeout_minutes(1u32)
                .add_env(("CI_TELEMETRY_EVENTS", events_file()))
                .add_env(("OTLP_LOGS_URL", "https://otlp.macro-internal.com/v1/logs"))
                .add_env(("OTLP_HEADERS", INGEST.outputs.headers.read())),
        )
        .add_step(
            GrafanaGrafanaGithubActionsGhaOtelExport::new(
                "Export workflow, job and step traces",
                github().token(),
            )
            .step()
            .id("traces")
            .if_condition(PREFLIGHT.outputs.export.read().is_set())
            .add_env(("OTEL_SERVICE_NAME", "github-actions"))
            .add_env(("OTEL_RESOURCE_ATTRIBUTES", "deployment.environment=ci"))
            .add_env(("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf"))
            .add_env((
                "OTEL_EXPORTER_OTLP_ENDPOINT",
                "https://otlp.macro-internal.com",
            ))
            .add_env(("OTEL_EXPORTER_OTLP_HEADERS", INGEST.outputs.headers.read())),
        )
}
