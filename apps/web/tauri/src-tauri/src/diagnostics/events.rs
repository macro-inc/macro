//! Small, content-free history owned by the host, independent of WebContent.

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

const CAPACITY: usize = 128;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum ReloadReason {
    CacheReplacedAutomatic,
    UpdateAccepted,
    FailedLoadRecovery,
    UserRecovery,
    Logout,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum NavigationCause {
    Initial,
    External,
    Navigate,
    History,
    Search,
}

/// A route id or entity type defined in app code, never user text.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(try_from = "String", into = "String")]
pub struct CodeName(String);

impl From<CodeName> for String {
    fn from(name: CodeName) -> Self {
        name.0
    }
}

impl TryFrom<String> for CodeName {
    type Error = &'static str;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        let mut chars = value.chars();
        let valid = value.len() <= 64
            && chars
                .next()
                .is_some_and(|first| first.is_ascii_alphabetic())
            && chars.all(|next| next.is_ascii_alphanumeric() || next == '-' || next == '_');
        if valid {
            Ok(Self(value))
        } else {
            Err("expected a code-defined name")
        }
    }
}

/// Closed schema: never accept arbitrary text, URLs, or message content.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FrontendEvent {
    Started {
        previous_instance_id: Option<Uuid>,
    },
    Heartbeat {
        visible: bool,
        online: bool,
    },
    Visibility {
        visible: bool,
    },
    Connectivity {
        online: bool,
    },
    ReloadRequested {
        reload_id: Uuid,
        reason: ReloadReason,
    },
    /// A pane started navigating; recorded before the destination loads so a
    /// termination while it loads still names it.
    Navigated {
        cause: NavigationCause,
        route: CodeName,
        from_route: Option<CodeName>,
        entity_type: Option<CodeName>,
    },
    /// Clears identifiers before another account can take over the WebView.
    AccountCleared,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum NativeEvent {
    #[cfg(any(mobile, test))]
    Foreground,
    #[cfg(any(mobile, test))]
    Background,
    #[cfg(any(target_os = "ios", test))]
    MemoryWarning,
    WebContentTerminated,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(untagged)]
pub enum Event {
    Frontend(FrontendEvent),
    Native(NativeEvent),
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEvent {
    pub sequence: u32,
    // Milliseconds since epoch fit exactly in a JavaScript number.
    #[cfg_attr(test, specta(type = specta_typescript::Number))]
    pub timestamp_ms: u64,
    pub frontend_instance_id: Option<Uuid>,
    pub event: Event,
}

#[derive(Clone, Default, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct EventSnapshot {
    pub events: Vec<DiagnosticEvent>,
    pub current_frontend_instance_id: Option<Uuid>,
    pub heartbeat: Option<DiagnosticEvent>,
    pub dropped: u32,
    pub memory_warning_reporting: bool,
}

#[derive(Default)]
pub struct EventBuffer {
    sequence: u32,
    events: VecDeque<DiagnosticEvent>,
    heartbeat: Option<DiagnosticEvent>,
    frontend: Option<Uuid>,
    retired_frontend: Option<Uuid>,
    dropped: u32,
}

impl EventBuffer {
    pub fn frontend(&mut self, id: Uuid, event: FrontendEvent, timestamp_ms: u64) {
        if self.retired_frontend == Some(id)
            && !matches!(event, FrontendEvent::ReloadRequested { .. })
        {
            return;
        }
        if let FrontendEvent::Started {
            previous_instance_id,
        } = &event
        {
            // Compare against the snapshot read by this document. A delayed
            // start from a replaced document cannot reclaim the buffer.
            if self.frontend == Some(id) || *previous_instance_id != self.frontend {
                return;
            }
            self.frontend = Some(id);
            self.heartbeat = None;
        } else if self.frontend != Some(id) {
            // A delayed IPC from the replaced document cannot overwrite its successor.
            return;
        }
        if matches!(event, FrontendEvent::AccountCleared) {
            self.events.clear();
            self.heartbeat = None;
            self.retired_frontend = Some(id);
            self.dropped = 0;
        }
        let heartbeat = matches!(event, FrontendEvent::Heartbeat { .. });
        let entry = self.entry(Some(id), Event::Frontend(event), timestamp_ms);
        if heartbeat {
            self.heartbeat = Some(entry);
        } else {
            self.push(entry);
        }
    }

    pub fn native(&mut self, event: NativeEvent, timestamp_ms: u64) {
        let entry = self.entry(self.frontend, Event::Native(event), timestamp_ms);
        self.push(entry);
    }

    fn entry(
        &mut self,
        frontend_instance_id: Option<Uuid>,
        event: Event,
        timestamp_ms: u64,
    ) -> DiagnosticEvent {
        self.sequence = self.sequence.saturating_add(1);
        DiagnosticEvent {
            sequence: self.sequence,
            timestamp_ms,
            frontend_instance_id,
            event,
        }
    }

    fn push(&mut self, entry: DiagnosticEvent) {
        if self.events.len() == CAPACITY {
            self.events.pop_front();
            self.dropped = self.dropped.saturating_add(1);
        }
        self.events.push_back(entry);
    }

    pub fn snapshot(&self) -> EventSnapshot {
        EventSnapshot {
            events: self.events.iter().cloned().collect(),
            current_frontend_instance_id: self.frontend,
            heartbeat: self.heartbeat.clone(),
            dropped: self.dropped,
            memory_warning_reporting: cfg!(target_os = "ios"),
        }
    }
}

#[cfg(test)]
mod test;
