//! The viewer on the in-process demo fleet: `cargo run -p agent_monitor_tui
//! --example demo`.

#[cfg(unix)]
#[tokio::main]
async fn main() -> Result<(), agent_monitor_tui::ViewerError> {
    use agent_monitor_tui::{FeedChoice, Options, run};

    run(Options {
        feed: FeedChoice::Demo { seed: 7 },
        fps: 12,
    })
    .await
}

#[cfg(not(unix))]
fn main() {}
