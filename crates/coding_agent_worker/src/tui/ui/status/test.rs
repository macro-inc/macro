use crate::tui::health::{DaemonHealth, Health, RuntimeHealth, TriggerHealth, Viewer};

use super::header_lines;

/// The bordered header of an 80-column terminal has 78 columns inside.
#[test]
fn every_state_fits_an_80_column_header_at_its_longest() {
    let health = Health {
        daemon: DaemonHealth::Running,
        runtime: RuntimeHealth::ServiceReportsOffline,
        triggers: TriggerHealth::Reconnecting {
            attempt: 120,
            last_error: "the service did not start answering".to_owned(),
        },
        viewer: Viewer::Background {
            terminal: "t12345".to_owned(),
        },
    };

    let lines = header_lines(&health, 4_000_000);

    let texts: Vec<String> = lines
        .iter()
        .map(|line| {
            line.spans
                .iter()
                .map(|span| span.content.as_ref())
                .collect()
        })
        .collect();
    for text in &texts {
        assert!(text.trim_end().chars().count() <= 78, "{text:?}");
    }
    let header = texts.join("\n");
    for label in [
        "daemon",
        "machine",
        "triggers",
        "viewer",
        "hc attach t12345",
    ] {
        assert!(header.contains(label), "{label} missing from {header}");
    }
}
