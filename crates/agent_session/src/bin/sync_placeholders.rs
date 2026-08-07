//! Rebuild the comms placeholder messages of one or more agent sessions.
//!
//! Placeholders are derived: a session's channel rows carry no content of
//! their own, only the composite id of the folded message they render. So
//! they can be dropped and rebuilt from `agent_session_log` at any time,
//! which is what this does - after a migration that changes how they are
//! keyed, or any time a channel has drifted from its log.
//!
//! Missing placeholders are created; existing ones are left alone. Deleting
//! the stale rows first is the caller's job, and safe:
//!
//! ```sh
//! psql "$DB" -c "DELETE FROM comms_messages WHERE agent_session_message_id IS NOT NULL"
//! psql "$DB" -At -c "SELECT id FROM agent_session" \
//!     | xargs cargo run --release -p agent_session --bin sync_placeholders -- -d "$DB"
//! ```

use agent_fold::domain::service::FoldedMessageService;
use agent_session::domain::model::AgentSessionId;
use agent_session::domain::ports::NoOpRealtime;
use agent_session::domain::service::{AgentSessionService, AgentSessionServiceImpl};
use agent_session::outbound::postgres::PgAgentSessionRepo;
use clap::Parser;
use macro_uuid::Uuid;
use sqlx::postgres::PgPoolOptions;
use std::process::ExitCode;
use std::time::{Duration, Instant};

/// Rebuild the comms placeholder messages of one or more agent sessions.
#[derive(Parser)]
struct Args {
    /// Sessions to rebuild. Every session is folded from scratch.
    #[arg(required = true)]
    sessions: Vec<Uuid>,

    /// Postgres holding the sessions.
    #[arg(
        short,
        long,
        default_value = "postgres://user:password@localhost:5432/macrodb"
    )]
    database_url: String,
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let args = Args::parse();

    let pool = match PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(10))
        .connect(&args.database_url)
        .await
    {
        Ok(pool) => pool,
        Err(error) => {
            eprintln!("error: cannot connect to {}: {error}", args.database_url);
            return ExitCode::FAILURE;
        }
    };

    // The same repo answers all three ports, as the composition root in
    // `document_storage_service` wires them. Nothing streams: repairing
    // placeholders appends no frames, so there is nothing to publish.
    let repo = PgAgentSessionRepo::new(pool);
    let service = AgentSessionServiceImpl::new(
        repo.clone(),
        FoldedMessageService::new(repo.clone()),
        repo,
        NoOpRealtime,
    );

    let mut failed = 0usize;
    for id in &args.sessions {
        let started = Instant::now();
        match service
            .sync_placeholders(AgentSessionId::new_from_uuid(*id))
            .await
        {
            Ok(()) => println!("{id}  ok ({:.1?})", started.elapsed()),
            Err(error) => {
                failed += 1;
                eprintln!("{id}  failed: {error}");
            }
        }
    }

    if failed == 0 {
        ExitCode::SUCCESS
    } else {
        eprintln!("{failed} of {} sessions failed", args.sessions.len());
        ExitCode::FAILURE
    }
}
