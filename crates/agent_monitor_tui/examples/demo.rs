//! The viewer on the in-process demo fleet, or on a collector's socket:
//!
//! ```sh
//! cargo run -p agent_monitor_tui --example demo
//! cargo run -p agent_monitor_tui --example demo -- --socket /tmp/monitor.sock
//! ```

#[cfg(not(unix))]
fn main() {
    eprintln!("the agent monitor needs Unix sockets");
}

#[cfg(unix)]
#[tokio::main]
async fn main() -> Result<(), agent_monitor_tui::ViewerError> {
    use std::path::PathBuf;

    use agent_monitor_tui::{FeedChoice, Options, run};
    use clap::Parser;

    #[derive(Parser)]
    struct Cli {
        /// Read the collector on this socket instead of the demo fleet.
        #[arg(long)]
        socket: Option<PathBuf>,
        /// The demo script's seed.
        #[arg(long, default_value_t = 7)]
        seed: u64,
        /// Frames per second while something animates.
        #[arg(long, default_value_t = 12)]
        fps: u8,
    }

    let cli = Cli::parse();
    let feed = match cli.socket {
        Some(socket) => FeedChoice::Socket(socket),
        None => FeedChoice::Demo { seed: cli.seed },
    };
    run(Options { feed, fps: cli.fps }).await
}
