//! Export completed GitHub Actions attempts as workflow/job/step traces, and as
//! push, job and step events for percentiles over days.

use gh_workflow::{
    Event, Expression, Job, Level, Permissions, Step, Workflow, WorkflowRun, WorkflowRunType,
};

#[cfg(test)]
mod test;

// Explicit names avoid recursively observing this exporter. Add new workflows here,
// and every workflow a PR runs: a push counts as finished when these have finished.
const OBSERVED_WORKFLOWS: &[&str] = &[
    "Android Play Release",
    "Android Release Drift",
    "Auto Label PRs",
    "Build Agent Daemon on Tag",
    "Build CEF with codecs",
    "Build AppImage",
    "Build Desktop on Tag",
    "Build Rust CI Image",
    "Build Web App",
    "Build macOS DMG",
    "CLA",
    "Cancel Stuck Cloud Storage Deploys",
    "Cleanup Preview",
    "Deploy AI Editing Worker",
    "Deploy All Services",
    "Deploy CLA Worker",
    "Deploy FusionAuth Instance",
    "Deploy Lexical Service",
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
    "PR Privacy Check",
    "Publish Android to Google Play",
    "Publish SDK",
    "Pull Request",
    "Pulumi Preview on PR",
    "Push local stack binaries",
    "Release SDK",
    "Release Label Check",
    "Reusable Deploy Service",
    "Reusable Preview Service",
    "SDK Check",
    "Test macrod update",
    "Web App Pr Checks",
    "cargo deny check",
    "cargo workspace dependency check",
    "check generated workflows",
    "check node_modules nix",
    "check tauri lockfiles",
    "platform parity",
    "cloud storage code check",
    "conventions code check",
    "deploy pulumi service",
    "iOS App Store Publish",
    "iOS App Store Release",
    "iOS Preview",
    "iOS Release Drift",
    "infra code check",
];
const HAS_JOBS: &str = "steps.preflight.outputs.export == 'true'";
const EVENTS_FILE: &str = "${{ runner.temp }}/ci-telemetry-events.json";

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

/// Run embedded TypeScript on the hosted image's Node, which strips types itself, so
/// the exporter needs no checkout, build or dependency.
fn node_script(source: &str) -> String {
    format!(
        "node --disable-warning=ExperimentalWarning --input-type=module-typescript <<'TELEMETRY_SCRIPT'\n{source}\nawait main();\nTELEMETRY_SCRIPT\n"
    )
}

fn export() -> Job {
    Job::default()
        // GitHub's hosted image supplies AWS CLI, Python and Node without a checkout/setup step.
        .runs_on("ubuntu-latest")
        .timeout_minutes(10u32)
        .add_step(
            Step::new("Check upstream exporter limits")
                .uses(
                    "actions",
                    "github-script",
                    "f28e40c7f34bde8b3046d885e986cb6290c5673b",
                )
                .id("preflight")
                .add_with(("script", include_str!("scripts/ci_telemetry_preflight.js"))),
        )
        // Before any credential exists, so nothing the run produced shares a step with it.
        .add_step(
            Step::new("Collect push, job and step events")
                .run(node_script(include_str!("scripts/ci_telemetry_collect.ts")))
                .shell("bash")
                .if_condition(Expression::new("always()"))
                .continue_on_error(true)
                .timeout_minutes(2u32)
                .add_env(("GITHUB_TOKEN", "${{ github.token }}"))
                .add_env(("CI_TELEMETRY_EVENTS", EVENTS_FILE)),
        )
        .add_step(
            Step::new("Assume CI telemetry role")
                .uses(
                    "aws-actions",
                    "configure-aws-credentials",
                    "e7f100cf4c008499ea8adda475de1042d6975c7b",
                )
                .if_condition(Expression::new("always()"))
                .add_with((
                    "role-to-assume",
                    "arn:aws:iam::569036502058:role/macro-observability-ci",
                ))
                .add_with(("aws-region", "us-east-1"))
                .add_with(("role-duration-seconds", 900)),
        )
        .add_step(
            Step::new("Read ingestion credential")
                .run(include_str!("scripts/read_ci_ingestion_credential.sh"))
                .id("ingest")
                .if_condition(Expression::new("always()"))
                .shell("bash"),
        )
        // Ahead of the traces: one failing must not cost the other, and this one is
        // the only record of a run the trace exporter refuses.
        .add_step(
            Step::new("Send push, job and step events")
                .run(node_script(include_str!("scripts/ci_telemetry_send.ts")))
                .shell("bash")
                .if_condition(Expression::new("always()"))
                .continue_on_error(true)
                .timeout_minutes(1u32)
                .add_env(("CI_TELEMETRY_EVENTS", EVENTS_FILE))
                .add_env(("OTLP_LOGS_URL", "https://otlp.macro-internal.com/v1/logs"))
                .add_env(("OTLP_HEADERS", "${{ steps.ingest.outputs.headers }}")),
        )
        .add_step(
            Step::new("Export workflow, job and step traces")
                .uses(
                    "grafana",
                    "grafana-github-actions/gha-otel-export",
                    "b1c422726cc4ff4adb0838ebca67586f24babb42",
                )
                .id("traces")
                .if_condition(Expression::new(HAS_JOBS))
                .add_with(("github-token", "${{ github.token }}"))
                .add_env(("OTEL_SERVICE_NAME", "github-actions"))
                .add_env(("OTEL_RESOURCE_ATTRIBUTES", "deployment.environment=ci"))
                .add_env(("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf"))
                .add_env((
                    "OTEL_EXPORTER_OTLP_ENDPOINT",
                    "https://otlp.macro-internal.com",
                ))
                .add_env((
                    "OTEL_EXPORTER_OTLP_HEADERS",
                    "${{ steps.ingest.outputs.headers }}",
                )),
        )
}
