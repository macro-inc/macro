//! How each health state reads: a word in the header, a sentence on the
//! Overview card. Words, not only colours, so `hc read` shows them too.

use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};

use super::layout::{field, span};
use super::theme::{DIM, ERR, OK, WARN};
use crate::tui::health::{DaemonHealth, Health, RuntimeHealth, TriggerHealth, Viewer};

#[cfg(test)]
mod test;

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
/// The header's status rows: daemon and machine, then triggers and viewer,
/// so each state stays visible in an 80-column terminal.
pub(super) fn header_lines(health: &Health, pid: u32) -> Vec<Line<'static>> {
    statuses(health, pid)
        .chunks(2)
        .map(|row| {
            let mut spans = vec![Span::raw(" ")];
            for (name, _, status) in row {
                spans.push(Span::styled(status.dot(), Style::new().fg(status.color)));
                spans.push(Span::styled(format!(" {name} "), Style::new().fg(DIM)));
                spans.push(Span::styled(status.word.clone(), status.text_style()));
                spans.push(Span::raw("  "));
            }
            Line::from(spans)
        })
        .collect()
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
        RuntimeHealth::ServiceStillListsOnline => Status::new(
            WARN,
            "dialing, service lists online",
            "not connected - dialing; the service still lists this harness online",
        ),
        RuntimeHealth::Unreachable => Status::new(
            WARN,
            "unreachable",
            "not connected - the service does not know this harness, or has not answered",
        ),
        RuntimeHealth::Disconnected => {
            Status::new(ERR, "disconnected", "not connected - the daemon is stopped")
        }
    }
}

fn triggers(health: &TriggerHealth) -> Status {
    match health {
        TriggerHealth::Connecting => Status::new(WARN, "connecting", "opening the event stream"),
        TriggerHealth::NoAgentsBound => Status::new(
            DIM,
            "idle, no agents bound",
            "idle - no agents are bound, so no stream is open",
        ),
        TriggerHealth::Live {
            verified: true,
            quiet,
        } => Status::new(
            OK,
            format!("live {}", span(*quiet)),
            format!(
                "live - the service heartbeats it; last event or heartbeat {} ago",
                span(*quiet)
            ),
        ),
        TriggerHealth::Live {
            verified: false,
            quiet,
        } => Status::new(
            DIM,
            format!("open {}", span(*quiet)),
            format!(
                "open - this service sends no heartbeats, so only the connection is known up; \
                 last event (or the open) {} ago",
                span(*quiet)
            ),
        ),
        TriggerHealth::Reconnecting {
            attempt,
            last_error,
        } => Status::new(
            WARN,
            format!("reconnecting #{attempt}"),
            format!("reconnecting (attempt {attempt}): {last_error}"),
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
            "in an app tab",
            format!("in a herdr app tab (hc terminal {terminal})"),
        ),
        Viewer::Background { terminal } => Status::new(
            WARN,
            format!("not in an app tab (hc attach {terminal})"),
            format!(
                "hc terminal {terminal}, in no herdr app tab - hc attach {terminal} to view it"
            ),
        ),
        Viewer::Unknown { terminal } => Status::new(
            DIM,
            format!("hc {terminal}"),
            format!("hc terminal {terminal}; herdr-core has not said yet whether the app shows it"),
        ),
        Viewer::NoHcBin => Status::new(
            WARN,
            "no HC_BIN",
            "a herdr-core terminal without HC_BIN: macrod opens no herdr windows; \
             update herdr-core, then restart this terminal in herdr",
        ),
    }
}
