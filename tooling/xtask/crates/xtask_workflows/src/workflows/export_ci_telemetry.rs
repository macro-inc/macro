//! Export completed GitHub Actions attempts as workflow/job/step traces.

use gh_workflow::{
    Event, Expression, Job, Level, Permissions, Step, Workflow, WorkflowRun, WorkflowRunType,
};

// Explicit names avoid recursively observing this exporter. Add new workflows here.
const OBSERVED_WORKFLOWS: &[&str] = &[
    "Auto Label PRs",
    "Build Agent Daemon on Tag",
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
    "Deploy Preview",
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
    "Publish Android to Google Play",
    "Publish SDK",
    "Pull Request",
    "Pulumi Preview on PR",
    "Push local stack binaries",
    "Release SDK",
    "Reusable Deploy Service",
    "Reusable Preview Service",
    "SDK Check",
    "Web App Pr Checks",
    "cargo deny check",
    "cargo workspace dependency check",
    "check generated workflows",
    "check node_modules nix",
    "cloud storage code check",
    "conventions code check",
    "deploy pulumi service",
    "iOS Preview",
    "infra code check",
];
const HAS_JOBS: &str = "steps.preflight.outputs.export == 'true'";

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
            id_token: Some(Level::Write),
            ..Default::default()
        })
        .add_job("export", export())
}

fn export() -> Job {
    Job::default()
        // GitHub's hosted image supplies AWS CLI and Python without a checkout/setup step.
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
        .add_step(
            Step::new("Assume CI telemetry role")
                .uses(
                    "aws-actions",
                    "configure-aws-credentials",
                    "e7f100cf4c008499ea8adda475de1042d6975c7b",
                )
                .if_condition(Expression::new(HAS_JOBS))
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
                .if_condition(Expression::new(HAS_JOBS))
                .shell("bash"),
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
