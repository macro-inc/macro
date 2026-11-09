//! How each health state reads: a word in the header, a sentence on the
//! Overview card. Words, not only colours, so `hc read` shows them too.

use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};

use super::layout::{field, span};
use super::theme::{DIM, ERR, OK, WARN};
use crate::daemon::StreamEnd;
use crate::outbound::stream::SILENCE_LIMIT;
use crate::tui::health::{DaemonHealth, Health, RuntimeHealth, TriggerHealth, Viewer};

struct Status {
    color: Color,
    word: String,
    detail: String,
}

impl Status {
    fn new(color: Color, word: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            color,
            word: word.into(),
            detail: detail.into(),
        }
    }

    fn dot(&self) -> &'static str {
        if self.color == DIM { "○" } else { "●" }
    }

    /// Healthy text stays plain; anything else takes its state's colour.
    fn text_style(&self) -> Style {
        if self.color == OK {
            Style::new()
        } else {
            Style::new().fg(self.color)
        }
    }
}

/// The header's status line: each state as a dot, its name and a word.
pub(super) fn header_line(health: &Health, pid: u32) -> Line<'static> {
    let mut spans = vec![Span::raw(" ")];
    for (name, _, status) in statuses(health, pid) {
        spans.push(Span::styled(status.dot(), Style::new().fg(status.color)));
        spans.push(Span::styled(format!(" {name} "), Style::new().fg(DIM)));
        spans.push(Span::styled(status.word.clone(), status.text_style()));
        spans.push(Span::raw("  "));
    }
    Line::from(spans)
}

/// The Overview card's rows, one per state.
pub(super) fn detail_rows(health: &Health, pid: u32) -> Vec<Line<'static>> {
    statuses(health, pid)
        .into_iter()
        .map(|(_, name, status)| {
            let style = status.text_style();
            field(name, Span::styled(status.detail, style))
        })
        .collect()
}

/// The states worth showing, with their header and card names. Unpaired,
/// there is only the daemon to speak of.
fn statuses(health: &Health, pid: u32) -> Vec<(&'static str, &'static str, Status)> {
    let daemon_status = ("daemon", "Daemon", daemon(health.daemon, pid));
    if health.daemon == DaemonHealth::NotPaired {
        return vec![daemon_status];
    }
    vec![
        daemon_status,
        ("machine", "Machine", runtime(health.runtime)),
        ("triggers", "Trigger stream", triggers(&health.triggers)),
        ("viewer", "Viewer", viewer(&health.viewer)),
    ]
}

fn daemon(health: DaemonHealth, pid: u32) -> Status {
    match health {
        DaemonHealth::NotPaired => Status::new(DIM, "not paired", "not paired"),
        DaemonHealth::Running => Status::new(OK, "running", format!("running · pid {pid}")),
        DaemonHealth::Stopped => {
            Status::new(ERR, "stopped", "stopped - check the Logs tab for why")
        }
    }
}

fn runtime(health: RuntimeHealth) -> Status {
    match health {
        RuntimeHealth::Connected => {
            Status::new(OK, "connected", "connected to the harness service")
        }
        RuntimeHealth::ServiceReportsOffline => Status::new(
            ERR,
            "connected, service reports offline",
            "connected, but the service reports this harness offline",
        ),
        RuntimeHealth::Dialing => Status::new(
            WARN,
            "dialing",
            "not connected yet - dialing the harness service",
        ),
        RuntimeHealth::Unreachable => Status::new(
            WARN,
            "unreachable",
            "not connected - the service does not know this harness",
        ),
        RuntimeHealth::Disconnected => {
            Status::new(ERR, "disconnected", "not connected - the daemon is stopped")
        }
    }
}

fn triggers(health: &TriggerHealth) -> Status {
    match health {
        TriggerHealth::Connecting => Status::new(WARN, "connecting", "opening the event stream"),
        TriggerHealth::Unbound => Status::new(
            DIM,
            "idle, no agents bound",
            "idle - no agents are bound, so no stream is open",
        ),
        TriggerHealth::Live { quiet } => Status::new(
            OK,
            format!("live {}", span(*quiet)),
            format!("live - last event or keep-alive {} ago", span(*quiet)),
        ),
        TriggerHealth::Stalled { quiet } => Status::new(
            ERR,
            format!("stalled {}", span(*quiet)),
            format!("stalled - nothing heard for {}", span(*quiet)),
        ),
        TriggerHealth::Reconnecting {
            attempt,
            cause: StreamEnd::Silent,
        } => Status::new(
            ERR,
            "stalled, reconnecting",
            format!(
                "stalled - silent for {}, reconnecting (attempt {attempt})",
                span(SILENCE_LIMIT)
            ),
        ),
        TriggerHealth::Reconnecting {
            attempt,
            cause: StreamEnd::Failed(error),
        } => Status::new(
            WARN,
            format!("reconnecting, attempt {attempt}"),
            format!("reconnecting (attempt {attempt}): {error}"),
        ),
        TriggerHealth::Stopped => Status::new(ERR, "stopped", "stopped with the daemon"),
    }
}

fn viewer(viewer: &Viewer) -> Status {
    match viewer {
        Viewer::Terminal => Status::new(OK, "terminal", "the terminal macrod was started in"),
        Viewer::HerdrPane => Status::new(OK, "herdr pane", "a herdr pane"),
        Viewer::HerdrTab { terminal } => Status::new(
            OK,
            "herdr tab",
            format!("a herdr app tab (hc terminal {terminal})"),
        ),
        Viewer::Background { terminal } => Status::new(
            WARN,
            format!("background {terminal}"),
            format!(
                "hc terminal {terminal}, in no herdr app tab - hc attach {terminal} to view it"
            ),
        ),
        Viewer::Unknown { terminal } => Status::new(
            DIM,
            "unknown",
            format!("hc terminal {terminal}; herdr-core has not said whether the app shows it"),
        ),
    }
}
