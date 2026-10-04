//! `docx_corpus`: renders documents and scores them against reference renders.

mod check;
mod fontconfig;
mod lines;
mod render;
mod score;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(about = "DOCX engine corpus tools")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Renders documents to PNG pages.
    Render(render::Args),
    /// Compares renders with reference renders and writes a report.
    Score(score::Args),
    /// Writes a fontconfig file for LibreOffice reference renders.
    Fontconfig(fontconfig::Args),
    /// Dumps the text lines of every page with their positions as JSON.
    Lines(lines::Args),
    /// Runs every document through rendering, the collaborative state,
    /// editing, tracked changes, header edits, copy/paste and saving.
    Check(check::Args),
}

fn main() {
    let cli = Cli::parse();
    let ok = match cli.command {
        Command::Render(args) => render::run(&args),
        Command::Score(args) => score::run(&args),
        Command::Fontconfig(args) => fontconfig::run(&args),
        Command::Lines(args) => lines::run(&args),
        Command::Check(args) => check::run(&args),
    };
    match ok {
        Ok(true) => {}
        Ok(false) => std::process::exit(1),
        Err(e) => {
            eprintln!("error: {e}");
            std::process::exit(2);
        }
    }
}
