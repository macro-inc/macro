//! `psd_render`: developer tools for the Photoshop engine.

use clap::Parser;

/// Developer tools for the Photoshop engine.
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
