//! Operator CLI for AI billing. See `AGENTS.md` for how to point it at an
//! environment.

use std::num::NonZeroU32;
use std::process::ExitCode;

use ai_billing::composition::pg_credit_grant_service;
use ai_billing::domain::CreditGrant;
use clap::{Parser, Subcommand};
use macro_env_var::env_var;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use sqlx::postgres::PgPoolOptions;

env_var! {
    struct DatabaseUrl;
}

#[derive(Parser)]
#[command(name = "ai-billing", about = "Operator tools for AI billing")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Add prepaid AI credit to the balance of the account that pays for a
    /// user. Credit funds usage beyond the plan allowance at the overage
    /// markup; it does not reset the allowance. Prints a dry run unless
    /// `--execute` is passed.
    GrantCredits {
        /// The user, as `macro|<email>`. A team member's grant lands on the
        /// team owner's balance.
        #[arg(long)]
        user: String,
        /// Customer cents to add, e.g. 1500 for $15.00 of credit.
        #[arg(long)]
        amount_cents: NonZeroU32,
        /// Why, and who issued it. Stored on the ledger entry.
        #[arg(long)]
        reason: String,
        /// Ledger entry id. Pass the id a dry run printed: re-running with the
        /// same id never books a second grant.
        #[arg(long)]
        grant_id: Option<Uuid>,
        /// Book the grant. Without it, nothing is written.
        #[arg(long)]
        execute: bool,
    },
}

#[tokio::main]
async fn main() -> ExitCode {
    match run(Cli::parse()).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(report) => {
            eprintln!("{report}");
            ExitCode::FAILURE
        }
    }
}

async fn run(cli: Cli) -> Result<(), rootcause::Report> {
    let Command::GrantCredits {
        user,
        amount_cents,
        reason,
        grant_id,
        execute,
    } = cli.command;
    let user = MacroUserIdStr::try_from(user)?;
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&DatabaseUrl::new()?)
        .await?;
    let service = pg_credit_grant_service(pool);
    let grant = CreditGrant {
        id: grant_id.unwrap_or_else(macro_uuid::generate_uuid_v7),
        amount_cents,
        note: format!("manual grant: {reason}"),
    };

    let target = service.target(&user).await?;
    let balance = service.balance_cents(&target.payer).await?;
    println!("user:     {}", user.as_ref());
    println!(
        "payer:    {} ({:?} plan)",
        target.payer.as_ref(),
        target.tier
    );
    println!("balance:  {balance} cents");
    println!("grant:    {amount_cents} cents, id {}", grant.id);
    println!("note:     {}", grant.note);
    if !execute {
        println!(
            "dry run: nothing written. Re-run with --execute --grant-id {}",
            grant.id
        );
        return Ok(());
    }

    let (_, inserted) = service.grant(&user, &grant).await?;
    let balance = service.balance_cents(&target.payer).await?;
    if inserted {
        println!("booked. balance now {balance} cents");
    } else {
        println!(
            "grant {} was already booked. balance {balance} cents",
            grant.id
        );
    }
    Ok(())
}
