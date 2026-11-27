use std::{
    fs::File,
    io::Read,
    net::{IpAddr, Ipv4Addr},
    time::Duration,
};

use anyhow::{Context, ensure};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_env::Environment;
use remote_env_var::NullSecretManager;
use serde::Deserialize;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use tokio::net::TcpListener;

use super::{
    CompletedWork, DateTime, Journal, MAX_OBSERVATIONS_PER_AGENT, Scope, Source, Utc, Uuid,
    pg::PgAuthority, signed::SignedAuthority, signed_inbound,
};

const MAX_FIXTURE_BYTES: u64 = 64 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyntheticJournal {
    agent: Uuid,
    completed: Vec<SyntheticCompletion>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyntheticCompletion {
    source_event: Uuid,
    document: Uuid,
    completed_at: DateTime<Utc>,
}

/// Run the opt-in signed Brain reader on an ephemeral loopback listener.
/// This entry point only connects to the explicitly configured local database.
pub async fn run_local_signed_brain_read() -> anyhow::Result<()> {
    let team = std::env::var("BOTS_BRAIN_TEAM_ID")
        .context("BOTS_BRAIN_TEAM_ID is required")?
        .parse::<Uuid>()
        .context("BOTS_BRAIN_TEAM_ID must be a UUID")?;
    ensure!(!team.is_nil(), "BOTS_BRAIN_TEAM_ID must identify a team");
    let database = std::env::var("BOTS_BRAIN_DATABASE_URL")
        .context("BOTS_BRAIN_DATABASE_URL is required")?
        .parse::<PgConnectOptions>()
        .map_err(|_| anyhow::anyhow!("BOTS_BRAIN_DATABASE_URL is invalid"))?;
    ensure!(
        database.get_socket().is_some()
            || database
                .get_host()
                .parse::<IpAddr>()
                .is_ok_and(|ip| ip.is_loopback()),
        "BOTS_BRAIN_DATABASE_URL must use a Unix socket or a numeric loopback address"
    );

    for name in ["JWT_SECRET_KEY", "AUDIENCE", "ISSUER"] {
        let value = macro_env_var::read_env(name).context("configure the isolated local issuer")?;
        ensure!(!value.trim().is_empty(), "{name} must be nonempty");
    }
    let jwt = JwtValidationArgs::new_with_secret_manager(Environment::Local, &NullSecretManager)
        .await
        .context("configure the isolated local JWT issuer")?;
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .acquire_timeout(Duration::from_secs(3))
        .connect_with(database.options([
            ("statement_timeout", "2500"),
            ("default_transaction_read_only", "on"),
        ]))
        .await
        .context("connect to the local Brain database")?;
    let authority = PgAuthority::new(pool);
    let journal = synthetic_journal(&authority, team).await?;

    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
    println!("{}", listener.local_addr()?);
    axum::serve(
        listener,
        signed_inbound::router(authority, team, jwt, journal),
    )
    .await?;
    Ok(())
}

async fn synthetic_journal(
    authority: &PgAuthority,
    team: Uuid,
) -> anyhow::Result<Option<(Scope, Journal)>> {
    let Some(path) = std::env::var_os("BOTS_BRAIN_SYNTHETIC_JOURNAL") else {
        return Ok(None);
    };

    let metadata = std::fs::metadata(&path).context("read synthetic journal metadata")?;
    ensure!(
        metadata.is_file() && metadata.len() <= MAX_FIXTURE_BYTES,
        "synthetic journal must be a bounded regular file"
    );
    let mut bytes = Vec::new();
    File::open(path)
        .context("open synthetic journal")?
        .take(MAX_FIXTURE_BYTES + 1)
        .read_to_end(&mut bytes)
        .context("read synthetic journal")?;
    ensure!(
        bytes.len() as u64 <= MAX_FIXTURE_BYTES,
        "synthetic journal is too large"
    );
    let fixture: SyntheticJournal =
        serde_json::from_slice(&bytes).context("parse synthetic journal")?;
    ensure!(
        fixture.completed.len() <= MAX_OBSERVATIONS_PER_AGENT,
        "synthetic journal contains too many completions"
    );
    let agent = authority
        .active_agent_key(fixture.agent, team)
        .await
        .map_err(|_| anyhow::anyhow!("resolve synthetic journal account"))?
        .context("synthetic journal account is unavailable")?;

    let scope = Scope { team, agent };
    let journal = Journal::default();
    for entry in fixture.completed {
        journal
            .observe(
                scope.clone(),
                CompletedWork {
                    source_event: entry.source_event,
                    source: Source::Document { id: entry.document },
                    completed_at: entry.completed_at,
                },
            )
            .map_err(|_| anyhow::anyhow!("invalid synthetic journal completion"))?;
    }

    Ok(Some((scope, journal)))
}
