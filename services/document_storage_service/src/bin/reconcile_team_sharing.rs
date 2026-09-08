//! Operator-only, bounded explicit team-share reconciliation.

use clap::Parser;
use service::team_share_reconciliation::{Options, reconcile_batch};
use sqlx::postgres::PgPoolOptions;

// Keep the CLI independent of application startup, HTTP state and remote clients.
#[path = "../service/team_share_reconciliation.rs"]
pub mod team_share_reconciliation;
mod service {
    pub use crate::team_share_reconciliation;
}
#[path = "../outbound/team_share_reconciliation.rs"]
mod pg_reconciliation;

macro_env_var::env_var! {
    /// Database to inspect. Operators must explicitly select the intended database.
    struct DatabaseUrl;
}

#[derive(Parser)]
#[command(
    about = "Reconcile explicit team sharing (dry-run by default). Review docs/TEAM_SHARE_ROLLOUT.md before applying."
)]
struct Args {
    /// Commit verified repairs. Without this flag no writes are persisted.
    #[arg(long)]
    apply: bool,
    /// Maximum roots per invocation (one transaction per root).
    #[arg(long, default_value_t = 100, value_parser = clap::value_parser!(i64).range(1..=1000))]
    batch_size: i64,
    /// Resume strictly after the last reported type/UUID cursor.
    #[arg(long, default_value = "")]
    after: String,
    /// Document UUID verified from historical managed-writer evidence. Repeatable.
    /// This never permits Owner, stale teams, multiple grants, or nonzero revisions.
    #[arg(long = "reviewed-document")]
    reviewed_documents: Vec<uuid::Uuid>,
}

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    let args = Args::parse();
    let options = Options {
        apply: args.apply,
        batch_size: args.batch_size,
        after: args.after,
        reviewed_documents: args.reviewed_documents,
    };
    let db = PgPoolOptions::new()
        .max_connections(2)
        .connect(DatabaseUrl::new()?.as_ref())
        .await?;
    let repository = pg_reconciliation::PgReconciliationRepository::new(db);
    let records = reconcile_batch(&repository, &options).await?;
    let mut applied = 0;
    for record in &records {
        println!(
            "{} findings={:?} action={:?} applied={} changed_since_review={}",
            record.cursor,
            record.classification.findings,
            record.classification.action,
            record.applied,
            record.changed_since_review
        );
        applied += usize::from(record.applied);
    }
    println!(
        "mode={} scanned={} repairs={applied}",
        if options.apply { "apply" } else { "dry-run" },
        records.len()
    );
    if let Some(last) = records.last() {
        println!("resume_after={}", last.cursor);
    }
    if records.len() < options.batch_size as usize {
        println!("end_of_scan=true");
    }
    Ok(())
}
