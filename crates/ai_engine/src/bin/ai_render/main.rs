//! `ai_render`: developer tools for the Illustrator engine.

use clap::Parser;

/// Developer tools for the Illustrator engine.
#[derive(Parser)]
struct Cli {
    /// Files to inspect.
    files: Vec<std::path::PathBuf>,
}

fn main() {
    let cli = Cli::parse();
    for f in cli.files {
        println!("{}", f.display());
    }
}
