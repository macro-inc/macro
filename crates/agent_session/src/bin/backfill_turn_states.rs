//! Initialize list activity for sessions created before the turn projection.
//!
//! Apply migrations, build with `--features cli`, then run bounded passes until
//! `examined` is zero: `backfill_turn_states --database-url "$DATABASE_URL" --limit 100`.
//! See the crate README for deployment instructions.

use std::num::NonZeroUsize;

use agent_session::domain::turn_state::backfill_turn_states;
use agent_session::outbound::postgres::PgAgentSessionRepo;
use clap::Parser;
use sqlx::postgres::PgPoolOptions;

#[derive(Parser)]
struct Args {
    /// MacroDB to backfill. Never logged.
    #[arg(long)]
    database_url: String,
    /// Maximum number of session histories to fold in this invocation.
    #[arg(long, default_value = "100")]
    limit: NonZeroUsize,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&args.database_url)
        .await?;
    let result = backfill_turn_states(&PgAgentSessionRepo::new(pool), args.limit).await?;
    println!(
        "examined={} projected={}",
        result.examined, result.projected
    );
    Ok(())
}
