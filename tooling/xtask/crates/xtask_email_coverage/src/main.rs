//! `cargo x email-coverage <command>`
//!
//! - `list` writes `crates/email_e2e/coverage/entrypoints.tsv` from the code.
//! - `list --check` fails when the checked-in file differs from the code.

use std::process::ExitCode;

use clap::{Parser, Subcommand};
use rootcause::prelude::*;
use xtask_email_coverage::{ENTRYPOINTS_PATH, diff, generate, read_tsv, render_tsv};

#[derive(Parser)]
#[command(
    name = "email-coverage",
    about = "Email end-to-end coverage of backend entry points"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// List every backend email entry point into entrypoints.tsv.
    List {
        /// Compare with the checked-in file instead of writing it.
        #[arg(long)]
        check: bool,
    },
}

fn main() -> ExitCode {
    let outcome = match Cli::parse().command {
        Command::List { check } => list(check),
    };

    // Printed with `Display`: `Debug`, which a returned error gets, quotes
    // and escapes the message.
    outcome.unwrap_or_else(|report| {
        eprintln!("{report}");
        ExitCode::FAILURE
    })
}

fn list(check: bool) -> Result<ExitCode, Report> {
    let root = xtask_paths::repo_root();
    let rows = generate(&root)?;
    let path = root.join(ENTRYPOINTS_PATH);
    let text = render_tsv(&rows);

    if !check {
        std::fs::write(&path, text).context(format!("could not write {ENTRYPOINTS_PATH}"))?;
        println!("wrote {} entry points to {ENTRYPOINTS_PATH}", rows.len());
        return Ok(ExitCode::SUCCESS);
    }

    let checked_in = read_tsv(&path)?;
    let differences = diff(&checked_in, &rows);
    let on_disk =
        std::fs::read_to_string(&path).context(format!("could not read {ENTRYPOINTS_PATH}"))?;
    if differences.is_empty() && on_disk == text {
        println!(
            "{ENTRYPOINTS_PATH} lists the code's {} entry points",
            rows.len()
        );
        return Ok(ExitCode::SUCCESS);
    }

    eprintln!("{ENTRYPOINTS_PATH} does not list the entry points the code has.");
    eprintln!("`-` rows are only in the file, `+` rows only in the code:\n");
    for difference in &differences {
        eprintln!("{difference}");
    }
    if differences.is_empty() {
        eprintln!("(the rows agree; the file's order, comments or whitespace differ)");
    }
    eprintln!("\nRun `cargo x email-coverage list` and commit the result.");
    Ok(ExitCode::FAILURE)
}
