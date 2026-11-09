//! Count actual export entries after binding generation and optimization.
use clap::Parser;
use std::path::PathBuf;
mod instrument;

#[derive(Parser)]
struct Args {
    #[arg(long)]
    input: PathBuf,
    #[arg(long)]
    output: PathBuf,
}

fn main() -> Result<(), rootcause::Report> {
    let args = Args::parse();
    let input = std::fs::read(args.input).map_err(rootcause::Report::new)?;
    let output = instrument::instrument(&input).map_err(rootcause::Report::new)?;
    std::fs::write(args.output, output).map_err(rootcause::Report::new)?;
    Ok(())
}
