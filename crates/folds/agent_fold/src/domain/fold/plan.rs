//! The agent's plan: its todo list, carried whole on every update.

use crate::domain::model::{MessagePart, PlanEntry, PlanEntryPriority, PlanEntryStatus};
use agent_client_protocol::schema::v1::Plan as AcpPlan;

use super::state::{Changed, FoldState};

impl FoldState {
    /// Handle a `plan` update: the agent's todo list, carried whole each time.
    ///
    /// The first update pushes a plan part onto the turn's agent message;
    /// every later one replaces that part wholesale, which is ACP's own
    /// contract ("the client replaces the entire plan with each update"). An
    /// update identical to what the part already holds changes nothing - the
    /// harness re-emits the list more often than it changes it.
    pub(super) fn apply_plan(&mut self, update: AcpPlan) -> Option<Changed> {
        let entries: Vec<PlanEntry> = update.entries.into_iter().map(plan_entry).collect();

        if let Some(position) = self.turn.as_ref().and_then(|turn| turn.plan_position) {
            let (message, parts) = self.agent_parts_mut()?;
            if let Some(MessagePart::Plan { entries: existing }) = parts.get_mut(position) {
                if *existing == entries {
                    return None;
                }
                *existing = entries;
            }
            return Some(Changed::updated(message));
        }

        // An empty list derives nothing to render, so no part is created for
        // one; the turn's first non-empty update creates it. A list that
        // *becomes* empty is a replacement like any other, handled above.
        if entries.is_empty() {
            return None;
        }

        let (changed, position) = self.push_agent_part(MessagePart::Plan { entries })?;
        self.open_turn().plan_position = Some(position);
        Some(changed)
    }
}

/// An ACP plan entry in the fold's own vocabulary.
pub(super) fn plan_entry(entry: agent_client_protocol::schema::v1::PlanEntry) -> PlanEntry {
    PlanEntry {
        content: entry.content,
        priority: plan_entry_priority(entry.priority),
        status: plan_entry_status(entry.status),
    }
}

pub(super) fn plan_entry_priority(
    priority: agent_client_protocol::schema::v1::PlanEntryPriority,
) -> PlanEntryPriority {
    use agent_client_protocol::schema::v1::PlanEntryPriority as Acp;
    match priority {
        Acp::High => PlanEntryPriority::High,
        Acp::Medium => PlanEntryPriority::Medium,
        Acp::Low => PlanEntryPriority::Low,
        // `#[non_exhaustive]`; a priority ACP adds later is not demonstrably
        // more or less important than the middle.
        _ => PlanEntryPriority::Medium,
    }
}

pub(super) fn plan_entry_status(
    status: agent_client_protocol::schema::v1::PlanEntryStatus,
) -> PlanEntryStatus {
    use agent_client_protocol::schema::v1::PlanEntryStatus as Acp;
    match status {
        Acp::Pending => PlanEntryStatus::Pending,
        Acp::InProgress => PlanEntryStatus::InProgress,
        Acp::Completed => PlanEntryStatus::Completed,
        // `#[non_exhaustive]`; an unknown status has not demonstrably
        // finished, same as `ToolStatus`.
        _ => PlanEntryStatus::Pending,
    }
}
