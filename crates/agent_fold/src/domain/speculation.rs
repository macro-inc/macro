//! Unconfirmed client actions folded on a fork of the confirmed history.
//!
//! A client that issues an action knows exactly which frame the harness will
//! log for it, because the harness builds that frame with
//! [`AgentAction::to_runtime`] and this module builds its copy the same way.
//! So the fold can show the action's effect before the log confirms it:
//! the confirmed machine stays authoritative, and the unconfirmed frames form
//! a *suffix* replayed on a clone of it. Three things can then happen to a
//! suffix entry:
//!
//! - **Promote.** A confirmed row matches it - same request id, or for a
//!   frame that carries none the same method or content - and the entry is
//!   dropped. The committed machine now derives what the fork already
//!   showed, minus the pending mark.
//! - **Rebase.** A confirmed row matches nothing while the suffix is
//!   non-empty. It belongs *before* the suffix, so the fork is rebuilt:
//!   clone the committed machine, replay the suffix.
//! - **Retract.** The caller learns the server will never log it (the POST
//!   failed, the control was rejected) and the suffix loses it. Rebase.
//!
//! Only frames this client causes are ever synthesized. What the runtime
//! answers is never predicted: a speculated stop renders as stopping and a
//! speculated prompt as starting, and the turn closes when the log says so.
//!
//! Think of a git rebase: the confirmed log is upstream, the suffix is the
//! local commits replayed on top, and each one disappears the moment upstream
//! contains it.

use std::borrow::Cow;

use agent_client_protocol::RawJsonRpcMessage;
use agent_client_protocol::schema::v1::SessionId;
use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use agent_runtime_protocol::domain::schema::v0::ToRuntimeMessage;
use macro_user_id::user_id::MacroUserIdStr;

use super::fold::FoldMachineImpl;
use super::ingestion::{LogCursor, LogIngestion};
use super::log::{AgentSessionId, AgentSessionLog, Message};
use super::model::{FoldEvent, FoldedMessage, SessionMetadata};

#[cfg(test)]
mod test;

/// The ACP session id a synthesized frame names before the log has shown the
/// real one - a first prompt into a session whose runtime is still booting.
/// The fold's handlers ignore it; only the replay gate reads it, and that gate
/// is closed while nothing has been opened yet. The confirmed frame carries
/// the real id and promotes by request id - or, for a stop, by method - so
/// the placeholder never sticks.
const PLACEHOLDER_ACP_SESSION: &str = "pending";

/// One thing that can happen to a client's view of a session log.
#[derive(Debug)]
pub enum FoldInput {
    /// Authoritative history from the top of the log. Resets the committed
    /// tier, drops every suffix entry the rows already confirm, and rebuilds
    /// the fork. Must come first; a fresh fold refuses everything else.
    Snapshot(Vec<(LogCursor, AgentSessionLog)>),
    /// One durable row, in delivery order.
    Confirmed(LogCursor, AgentSessionLog),
    /// An action this client issued that the log has not confirmed.
    Speculated(Speculation),
    /// An action the server will never log: the request that carried it
    /// failed, or the control was refused.
    Retracted(AgentActionId),
}

/// An action to fold before the log confirms it.
#[derive(Debug, Clone)]
pub struct Speculation {
    action_id: AgentActionId,
    action: AgentAction,
    user_id: Option<MacroUserIdStr<'static>>,
}

impl Speculation {
    /// An action under the id the client will send it with. The id is what a
    /// confirmed row is matched on where the wire carries one; a stop and an
    /// elicitation answer carry no id, and are matched as described on
    /// [`Pending::is_confirmed_by`].
    #[must_use]
    pub fn new(
        action_id: AgentActionId,
        action: AgentAction,
        user_id: Option<MacroUserIdStr<'static>>,
    ) -> Self {
        Self {
            action_id,
            action,
            user_id,
        }
    }
}

/// Why an input could not be folded.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SpeculationError {
    /// A live or speculative frame arrived before any snapshot. Folding from
    /// the middle of a log derives a session that never happened, so the
    /// caller has to fetch first.
    #[error("the fold has no snapshot yet; a snapshot must be the first input")]
    NoSnapshot,
    /// The action could not be encoded as the frame the harness would log.
    #[error("the action could not be encoded as an ACP frame: {0}")]
    Encode(String),
}

/// A confirmed fold with this client's unconfirmed actions replayed on top.
///
/// [`Self::messages`] and [`Self::metadata`] read the fork while anything is
/// pending and the committed machine otherwise, so a reader never sees two
/// machines - only one conversation that occasionally gets ahead of the log.
pub struct SpeculativeFold {
    session: AgentSessionId,
    /// Everything the durable log has confirmed.
    committed: LogIngestion,
    /// Whether a snapshot has been folded. Nothing else is accepted before.
    snapshotted: bool,
    /// Frames this client caused that the log has not confirmed, in order.
    suffix: Vec<Pending>,
    /// `committed` plus `suffix`. `None` whenever the suffix is empty.
    fork: Option<FoldMachineImpl>,
}

/// One suffix entry: the frame as it was folded, and what a confirmed row
/// has to look like to be it.
#[derive(Debug, Clone)]
struct Pending {
    action_id: AgentActionId,
    frame: AgentSessionLog,
}

impl Pending {
    /// Whether `row` is the log's confirmation of this entry.
    ///
    /// A request carries the action id on the wire, so it matches on that
    /// alone: the harness composes prompts (mentions, context) after
    /// accepting them, so the confirmed text may legitimately differ from
    /// what was speculated, and the confirmed content wins.
    ///
    /// A notification - a stop - carries no id, and its content is no help
    /// either: `session/cancel` is byte-identical for every stop in a
    /// session, and one speculated before the log showed the ACP session
    /// names [`PLACEHOLDER_ACP_SESSION`] where the confirmed frame names the
    /// real id, so full content never matches. It matches on the method
    /// instead, and on the user where both rows name one.
    ///
    /// Everything else - an elicitation answer, which is a response on the
    /// agent's own request id - matches on content, which is deterministic:
    /// the agent's id plus the answer, encoded the one way
    /// [`AgentAction::to_runtime`] encodes it.
    fn is_confirmed_by(&self, row: &AgentSessionLog) -> bool {
        if let Some(id) = request_action_id(row) {
            return id == self.action_id;
        }
        if request_action_id(&self.frame).is_some() {
            return false;
        }
        match (notification_method(&self.frame), notification_method(row)) {
            (Some(mine), Some(theirs)) => mine == theirs && self.same_user_as(row),
            _ => {
                serde_json::to_value(&self.frame.content).ok()
                    == serde_json::to_value(&row.content).ok()
            }
        }
    }

    /// Whether `row` was issued by whoever issued this entry. A row that
    /// names no user cannot contradict one that does, so it is accepted.
    fn same_user_as(&self, row: &AgentSessionLog) -> bool {
        match (&self.frame.user_id, &row.user_id) {
            (Some(mine), Some(theirs)) => mine == theirs,
            _ => true,
        }
    }
}

/// The method of a notification frame, if the row is one.
fn notification_method(row: &AgentSessionLog) -> Option<&str> {
    match &row.content {
        Message::ToRuntime(ToRuntimeMessage::Acp(acp)) => match &acp.0 {
            RawJsonRpcMessage::Notification(notification) => Some(notification.method.as_ref()),
            _ => None,
        },
        _ => None,
    }
}

/// The action id a runtime-bound request carries, if the row is one.
fn request_action_id(row: &AgentSessionLog) -> Option<AgentActionId> {
    match &row.content {
        Message::ToRuntime(ToRuntimeMessage::Acp(acp)) => match &acp.0 {
            RawJsonRpcMessage::Request(request) => AgentActionId::from_request_id(&request.id),
            _ => None,
        },
        _ => None,
    }
}

impl SpeculativeFold {
    /// A fold for `session` that has seen nothing. The first input must be a
    /// [`FoldInput::Snapshot`].
    #[must_use]
    pub fn new(session: AgentSessionId) -> Self {
        Self {
            session,
            committed: LogIngestion::default(),
            snapshotted: false,
            suffix: Vec::new(),
            fork: None,
        }
    }

    /// Every message as the reader should see it: the fork's while anything
    /// is pending, the committed machine's otherwise.
    #[must_use]
    pub fn messages(&self) -> &[FoldedMessage] {
        self.tier().messages()
    }

    /// Session metadata, from the same tier as [`Self::messages`].
    #[must_use]
    pub fn metadata(&self) -> &SessionMetadata {
        self.tier().metadata()
    }

    /// The action ids still waiting on the log.
    pub fn pending(&self) -> impl Iterator<Item = AgentActionId> + '_ {
        self.suffix.iter().map(|pending| pending.action_id)
    }

    fn tier(&self) -> &FoldMachineImpl {
        self.fork.as_ref().unwrap_or(&self.committed.machine)
    }

    /// Fold one input, reporting what it changed in the same vocabulary a
    /// plain machine push does. A rebase or snapshot reports
    /// [`FoldEvent::MessagesReplaced`]; everything else reports only what
    /// moved, which for a promotion is the confirmed message losing its
    /// pending mark.
    ///
    /// # Errors
    ///
    /// See [`SpeculationError`].
    pub fn push(&mut self, input: FoldInput) -> Result<Vec<FoldEvent<'_>>, SpeculationError> {
        match input {
            FoldInput::Snapshot(rows) => {
                self.snapshotted = true;
                for (_, row) in &rows {
                    self.settle(row);
                }
                self.committed.replace_snapshot(rows);
                Ok(self.rebase())
            }
            FoldInput::Confirmed(cursor, row) => {
                if !self.snapshotted {
                    return Err(SpeculationError::NoSnapshot);
                }
                let promoted = self.settle(&row);
                if self.suffix.is_empty() {
                    // Nothing pending after this row: the fork, if any, is
                    // now redundant and the committed machine's own report
                    // describes the change - for a promotion, the message
                    // the reader already has, minus its pending mark.
                    self.fork = None;
                    let events: Vec<FoldEvent<'static>> = self
                        .committed
                        .push(cursor, row)
                        .into_iter()
                        .map(FoldEvent::into_owned)
                        .collect();
                    // A promoted row the snapshot already held reports
                    // nothing from the machine, yet the reader still shows
                    // the fork's pending message: restate the committed view.
                    if promoted && events.is_empty() {
                        return Ok(self.replaced());
                    }
                    return Ok(events);
                }
                let _ = self.committed.push(cursor, row);
                Ok(self.rebase())
            }
            FoldInput::Speculated(speculation) => {
                if !self.snapshotted {
                    return Err(SpeculationError::NoSnapshot);
                }
                // The log got there first: the confirmed row can land over
                // the socket before the control response names its id, and
                // a client re-speculating under that id must not double it.
                if self.already_reflected(&speculation) {
                    return Ok(Vec::new());
                }
                let frame = self.synthesize(&speculation)?;
                let fork = self
                    .fork
                    .get_or_insert_with(|| self.committed.machine.clone());
                let events: Vec<FoldEvent<'static>> = fork
                    .push_speculative(frame.clone())
                    .into_iter()
                    .map(FoldEvent::into_owned)
                    .collect();
                self.suffix.push(Pending {
                    action_id: speculation.action_id,
                    frame,
                });
                Ok(events)
            }
            FoldInput::Retracted(action_id) => {
                let before = self.suffix.len();
                self.suffix.retain(|pending| pending.action_id != action_id);
                if self.suffix.len() == before {
                    return Ok(Vec::new());
                }
                Ok(self.rebase())
            }
        }
    }

    /// The frame the harness will log for `speculation`, built the way the
    /// harness builds it.
    fn synthesize(&self, speculation: &Speculation) -> Result<AgentSessionLog, SpeculationError> {
        let acp_session = self
            .committed
            .machine
            .acp_session_id()
            .cloned()
            .unwrap_or_else(|| SessionId::from(PLACEHOLDER_ACP_SESSION));
        let message = speculation
            .action
            .to_runtime(&acp_session, speculation.action_id.to_request_id())
            .map_err(|error| SpeculationError::Encode(error.to_string()))?;
        Ok(AgentSessionLog {
            agent_session_id: self.session,
            user_id: speculation.user_id.clone(),
            content: Message::ToRuntime(message),
        })
    }

    /// Whether the fold already shows what this speculation would add, so
    /// folding it again would only double it.
    ///
    /// A prompt, a compact and a model change carry their action id on the
    /// wire, so the committed fold answers for them directly - and only the
    /// committed fold, because a second prompt while one is still pending is
    /// an ordinary queued prompt, not a duplicate.
    ///
    /// A stop and an elicitation answer carry no action id, so each is
    /// recognized by the effect it has already had, on the fork as much as on
    /// the committed machine: two of either add nothing the first did not,
    /// and a second suffix entry that nothing distinguishes would outlive the
    /// one confirmed row that could settle it.
    fn already_reflected(&self, speculation: &Speculation) -> bool {
        match &speculation.action {
            AgentAction::Stop => self.tier().stop_requested(),
            AgentAction::RespondElicitation(answer) => {
                !self.tier().metadata().pending_elicitation().is_some_and(|pending| pending.request_id == answer.request_id)
                    && self.tier().elicitation_answered(&answer.request_id)
            }
            AgentAction::RespondToPermission(answer) => !self.tier().metadata().pending_interactions.iter().any(|pending| {
                matches!(pending, super::model::PendingInteraction::Permission(permission)
                    if permission.request_id == super::model::AgentRequestId::from(&answer.request_id))
            }) && self
                .tier()
                .messages()
                .iter()
                .flat_map(|message| message.parts.iter())
                .any(|part| {
                    matches!(part,
                        super::model::MessagePart::Permission { request_id, outcome, .. }
                            if *request_id == super::model::AgentRequestId::from(&answer.request_id)
                                && !matches!(outcome, super::model::PermissionOutcome::Pending)
                    )
                }),
            AgentAction::Prompt(_) | AgentAction::Compact | AgentAction::SetModel(_) => self
                .committed
                .machine
                .messages()
                .iter()
                .any(|message| message.request_id == Some(speculation.action_id)),
        }
    }

    /// Drop the suffix entry `row` confirms, if any. `true` when one was.
    fn settle(&mut self, row: &AgentSessionLog) -> bool {
        let Some(index) = self
            .suffix
            .iter()
            .position(|pending| pending.is_confirmed_by(row))
        else {
            return false;
        };
        self.suffix.remove(index);
        true
    }

    /// Rebuild the fork from the committed machine and the suffix, and report
    /// the whole view - the only honest report when what changed is "where
    /// the suffix sits".
    fn rebase(&mut self) -> Vec<FoldEvent<'_>> {
        if self.suffix.is_empty() {
            self.fork = None;
        } else {
            let mut fork = self.committed.machine.clone();
            for pending in &self.suffix {
                let _ = fork.push_speculative(pending.frame.clone());
            }
            self.fork = Some(fork);
        }
        self.replaced()
    }

    fn replaced(&self) -> Vec<FoldEvent<'_>> {
        vec![
            FoldEvent::MessagesReplaced(Cow::Borrowed(self.messages())),
            FoldEvent::MetadataUpdated(Cow::Borrowed(self.metadata())),
        ]
    }
}
