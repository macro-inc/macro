//! Developer CLI for the PPTX corpus: render decks, score them against
//! LibreOffice reference renders, keep the fidelity baseline, and check that
//! edits round-trip losslessly.

mod corpus;
mod report;
mod roundtrip;
mod score;

use clap::{Parser, Subcommand};
use pptx_engine::Presentation;
use pptx_engine::font::FontDb;
use std::path::PathBuf;

#[derive(Parser)]
#[command(about = "Render, score, and round-trip PPTX files with pptx_engine")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Render every slide of a deck to PNG files.
    Render {
        /// The .pptx file.
        file: PathBuf,
        /// Output directory.
        #[arg(long)]
        out: PathBuf,
        /// Output width in pixels.
        #[arg(long, default_value_t = 960)]
        width: u32,
        /// Only these 1-based slide numbers.
        #[arg(long, value_delimiter = ',')]
        slides: Vec<usize>,
    },
    /// Render the corpus, score it against reference PNGs, and check (or update) the baseline.
    Score(score::Args),
    /// Check lossless saving, edits, undo, and package integrity on every corpus deck.
    Roundtrip(roundtrip::Args),
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    let ok = match cli.command {
        Command::Render {
            file,
            out,
            width,
            slides,
        } => {
            let mut p = Presentation::open(std::fs::read(&file)?)?;
            std::fs::create_dir_all(&out)?;
            let fonts = FontDb::global();
            for i in 0..p.slides().len() {
                if !slides.is_empty() && !slides.contains(&(i + 1)) {
                    continue;
                }
                let start = std::time::Instant::now();
                let r = p.render_slide(i, width, fonts)?;
                let path = out.join(format!("slide-{:03}.png", i + 1));
                std::fs::write(&path, r.to_png())?;
                println!("{} ({} ms)", path.display(), start.elapsed().as_millis());
            }
            true
        }
        Command::Score(args) => score::run(&args)?,
        Command::Roundtrip(args) => roundtrip::run(&args)?,
    };
    if !ok {
        std::process::exit(1);
    }
    Ok(())
}
