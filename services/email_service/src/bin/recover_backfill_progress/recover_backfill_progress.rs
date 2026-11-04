//! Prepare or apply one reviewed legacy recovery. This tool never sends SQS.

use clap::Parser;
use macro_entrypoint::MacroEntrypoint;
use macro_env_var::env_vars;

env_vars! { struct DatabaseUrl; }
use models_email::service::backfill::{
    BackfillOperation, BackfillPubsubMessage, InitPayload, JobScopedPayload,
};
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

#[derive(Parser)]
struct Args {
    /// Legacy job to replace; never a user/link identifier.
    #[arg(long)]
    job_id: Uuid,
    /// Cancel this legacy job and create its replacement. Without this flag,
    /// only show its current state for review.
    #[arg(long, requires = "output")]
    apply: bool,
    /// Private file receiving the exact Init queue body; no queue send occurs.
    #[arg(long)]
    output: Option<std::path::PathBuf>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let entrypoint = MacroEntrypoint::default().init();
    let result = run().await;
    entrypoint.shutdown();
    result
}

async fn run() -> anyhow::Result<()> {
    let args = Args::parse();
    let db = PgPoolOptions::new()
        .max_connections(2)
        .connect(&DatabaseUrl::new()?)
        .await?;
    if !args.apply {
        let job = email_db_client::backfill::job::get::get_backfill_job(&db, args.job_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("job not found"))?;
        let durable = email_db_client::backfill::progress::is_tracked(&db, args.job_id).await?;
        println!(
            "{}",
            serde_json::json!({
                "job_id": args.job_id,
                "status": format!("{:?}", job.status),
                "has_link": job.link_id.is_some(),
                "durable_progress": durable,
                "action": "review before --apply; replacement performs a full recovery sweep",
            })
        );
        return Ok(());
    }
    let replacement =
        email_db_client::backfill::recovery::restart_legacy_job(&db, args.job_id).await?;
    // A failure to write/publish cannot lose the replacement mapping; a
    // repeated command returns the same Init operation.
    let output = args
        .output
        .ok_or_else(|| anyhow::anyhow!("--apply requires --output"))?;
    let body = serde_json::to_string(&BackfillPubsubMessage {
        backfill_operation: BackfillOperation::Init(JobScopedPayload {
            link_id: replacement.link_id,
            job_id: replacement.job_id,
            payload: InitPayload {},
        }),
    })?;
    std::fs::write(output, body)?;
    Ok(())
}
