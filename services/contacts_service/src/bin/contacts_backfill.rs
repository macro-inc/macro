//! Backfills the list-aware directory (`contact_list_members`,
//! `contact_inbox_members`) and audits the legacy `contacts_connections`
//! graph it replaces. See `services/contacts_service/README.md` for the run
//! order. Writes its report as JSON to `--report`; logs go to stdout.

use std::collections::{BTreeSet, HashSet};
use std::io::Write;
use std::path::PathBuf;
use std::str::FromStr;
use std::time::Duration;

use chrono::{DateTime, Utc};
use clap::{Parser, Subcommand, ValueEnum};
use contacts::domain::backfill::{
    BackfillPass, BackfillRequest, BackfillSettings, DirectoryBackfill,
};
use contacts::outbound::repository::DbContactsRepository;
use database_env_vars::DatabaseUrl;
use macro_entrypoint::MacroEntrypoint;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};

/// Every address the signup support roster (`MACRO_SUPPORT_EMAILS` in
/// `authentication_service`'s `create_user_webhook.rs`) has held. Each
/// version kept the first three, so any channel created from one holds an
/// address here.
const SUPPORT_ROSTER: [&str; 15] = [
    "jacob@macro.com",
    "julia@macro.com",
    "teo@macro.com",
    "valentina@macro.com",
    "chaitanya@macro.com",
    "austin@macro.com",
    "eric.hayes@macro.com",
    "gab@macro.com",
    "hutch@macro.com",
    "jackson@macro.com",
    "peter@macro.com",
    "rahul@macro.com",
    "sean@macro.com",
    "wolf@macro.com",
    "zhamilya@macro.com",
];

/// No single statement the backfill sends should run longer than this.
const STATEMENT_TIMEOUT: &str = "60s";

/// One connection: the backfill reads and writes in sequence.
const CONNECTIONS: u32 = 2;

#[derive(Parser)]
#[command(about = "Backfill contact lists from the legacy directory, or audit it")]
struct Cli {
    #[command(subcommand)]
    command: Command,

    /// Where to write the JSON report.
    #[arg(long)]
    report: PathBuf,

    /// Channels, snapshot rows, DMs and inbox owners per read.
    #[arg(long, default_value_t = 500, value_parser = clap::value_parser!(i64).range(1..=1000))]
    page_size: i64,

    /// Legacy edges per audit read.
    #[arg(long, default_value_t = 500, value_parser = clap::value_parser!(i64).range(1..=5000))]
    edge_page_size: i64,

    /// One owner's legacy contacts per inbox read.
    #[arg(long, default_value_t = 1000, value_parser = clap::value_parser!(i64).range(1..=5000))]
    contact_page_size: i64,

    /// Milliseconds to rest between reads and after every hundred writes.
    #[arg(long, default_value_t = 20)]
    pause_ms: u64,

    /// Support-roster addresses, comma separated; defaults to every address
    /// the roster has held.
    #[arg(long, value_delimiter = ',')]
    support_roster: Vec<String>,
}

#[derive(Subcommand)]
enum Command {
    /// Count rows left by deleted accounts, classify every legacy edge
    /// direction and project `interacted` rows. Writes nothing.
    Audit,
    /// Write the lists.
    Backfill {
        /// Read and count, but write nothing.
        #[arg(long)]
        dry_run: bool,

        /// Only re-derive from channel joins and DM messages at or after this
        /// RFC 3339 time, e.g. a little before `contacts-list-writes` was
        /// turned on. The inbox pass always reads every legacy edge.
        #[arg(long)]
        after: Option<DateTime<Utc>>,

        /// Passes to run, comma separated; all by default.
        #[arg(long, value_enum, value_delimiter = ',')]
        only: Vec<Pass>,
    },
}

#[derive(Clone, Copy, ValueEnum)]
enum Pass {
    Orphans,
    Channels,
    DirectMessages,
    Inbox,
}

impl From<Pass> for BackfillPass {
    fn from(pass: Pass) -> Self {
        match pass {
            Pass::Orphans => BackfillPass::Orphans,
            Pass::Channels => BackfillPass::Channels,
            Pass::DirectMessages => BackfillPass::DirectMessages,
            Pass::Inbox => BackfillPass::Inbox,
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Report> {
    MacroEntrypoint::default().init();
    let cli = Cli::parse();

    let roster: Vec<String> = if cli.support_roster.is_empty() {
        SUPPORT_ROSTER
            .iter()
            .map(|email| (*email).to_owned())
            .collect()
    } else {
        cli.support_roster
    };
    let support_roster = roster
        .iter()
        .map(|email| MacroUserIdStr::try_from_email(email.trim()))
        .collect::<Result<HashSet<_>, _>>()?;

    // Opened first, so a bad path fails before anything is written.
    let mut report_file = std::fs::File::create(&cli.report)?;

    let database_url = DatabaseUrl::new()?;
    let options = PgConnectOptions::from_str(&database_url)?
        .application_name("contacts_backfill")
        .options([("statement_timeout", STATEMENT_TIMEOUT)]);
    let db = PgPoolOptions::new()
        .max_connections(CONNECTIONS)
        .connect_with(options)
        .await?;

    let backfill = DirectoryBackfill {
        source: DbContactsRepository::new(db.clone()),
        lists: DbContactsRepository::new(db),
        settings: BackfillSettings {
            page_size: cli.page_size,
            edge_page_size: cli.edge_page_size,
            contact_page_size: cli.contact_page_size,
            pause: Duration::from_millis(cli.pause_ms),
            support_roster,
        },
    };

    let report = match cli.command {
        Command::Audit => serde_json::to_string_pretty(&backfill.audit().await?)?,
        Command::Backfill {
            dry_run,
            after,
            only,
        } => {
            let passes: BTreeSet<BackfillPass> = if only.is_empty() {
                [
                    Pass::Orphans,
                    Pass::Channels,
                    Pass::DirectMessages,
                    Pass::Inbox,
                ]
                .into_iter()
                .map(BackfillPass::from)
                .collect()
            } else {
                only.into_iter().map(BackfillPass::from).collect()
            };
            let request = BackfillRequest {
                passes,
                dry_run,
                after,
            };
            serde_json::to_string_pretty(&backfill.backfill(&request).await?)?
        }
    };
    report_file.write_all(report.as_bytes())?;
    tracing::info!(report = %cli.report.display(), "contacts backfill report written");
    Ok(())
}
