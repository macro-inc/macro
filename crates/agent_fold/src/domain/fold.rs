//! Collapsing a session's protocol log into renderable messages.
//!
//! # Why this cannot fail
//!
//! [`fold`] is total. Messages are derived on every read, so returning an
//! error would mean rendering an empty channel - strictly worse than rendering
//! a partially-understood session. Every case that looks like a failure is
//! instead a state worth showing:
//!
//! - A tool call with no result is in flight, or was interrupted when the
//!   session died. Its status stays [`ToolStatus::Pending`].
//! - A tool call whose opening frame carried no useful fields gets them from
//!   later patches. Until then it renders as a bare tool row.
//! - A permission request with no answer is outstanding.
//!
//! What is left over - a patch for a tool call that was never opened, an
//! update variant this fold does not model - is logged through [`FoldError`]
//! at [`tracing::Level::WARN`] instead, rather than aborting or being
//! threaded through the return value. That keeps the render path lenient
//! while letting tests be strict: a replay test asserts that folding a
//! recording logs nothing, so protocol drift fails loudly locally (where the
//! recordings live) rather than silently degrading in production.
//!
//! # Why one match rather than a registry
//!
//! Dispatch is a single explicit `match` over the protocol, in [`State::step`]
//! and the handlers it calls. A registry of self-describing handlers would
//! move the decision of what matches what into data, where it is invisible;
//! here every frame this fold understands is named in one place you can read
//! top-to-bottom, and every frame it ignores is an explicit arm.
//!
//! # Why the machine, and not `Iterator::fold`
//!
//! [`FoldMachineImpl`] is the fold; [`fold`] is a loop over it. The batch
//! form used to be primary - `log.into_iter().fold(State::default(), step)` -
//! and that shape forced two things this crate can no longer afford. It could
//! only answer "what does this whole log derive", so `agent_session` refolded
//! every session from scratch on every appended frame; and it held a turn's
//! agent message aside until the turn closed, so there was nothing to show a
//! reader while the agent was still talking.
//!
//! So the state is now a struct you push frames into. A turn's agent message
//! is pushed into [`State::messages`] the moment the agent produces its first
//! part and mutated in place afterwards, and each push reports which message
//! it touched. Both callers read the same machine: [`fold`] drives it to the
//! end and takes the messages, while a live session watches the per-push
//! reports. Deriving both from one implementation is what keeps them
//! agreeing - and they must agree exactly, because a
//! [`MessageId`](crate::domain::model::MessageId) derived here is persisted
//! on a comms placeholder row.

use std::borrow::Cow;

use crate::domain::log::{AgentSessionId, AgentSessionLog};
use crate::domain::model::{FoldEvent, FoldedMessage, SessionMetadata, TurnId};
use crate::domain::ports::{FoldMachine, FoldSession, LogRepo};

/// Config-option and session-info bookkeeping.
mod config;
/// Prose and reasoning chunks, and adding parts to the agent message.
mod content;
/// Control operations: set-model, compact, stop.
mod control;
/// ACP-to-vocabulary conversions shared by the handlers.
mod convert;
/// Permission requests and their answers.
mod permission;
/// The agent's plan (todo list).
mod plan;
/// The fold's state and the per-frame dispatch.
mod state;
/// Delegated agents and the calls nested under them.
mod subagent;
/// Tool calls and their patches.
mod tool_call;
/// Opening, closing, and failing turns.
mod turn;

use state::{Change, FoldState, StepChange};

/// Collapse a session's protocol log into renderable messages.
///
/// Drives a [`FoldMachineImpl`] to the end of the log and takes what it
/// derived. The per-frame reports are discarded - a caller that wants them
/// pushes into the machine itself.
///
/// Total by construction: unrecognized and incomplete frames are logged
/// through [`FoldError`] rather than aborting the fold. See the module docs
/// for why.
#[must_use]
pub fn fold(log: impl IntoIterator<Item = AgentSessionLog>) -> Vec<FoldedMessage> {
    fold_machine(log).into_messages()
}

fn fold_machine(log: impl IntoIterator<Item = AgentSessionLog>) -> FoldMachineImpl {
    let mut machine = FoldMachineImpl::new();
    for entry in log {
        let _ = machine.push(entry);
    }
    machine
}

/// The incremental fold: push a session's log frames in one at a time and it
/// reports which message each changed.
///
/// Holds the fold's whole [`State`], including every message derived so far,
/// which is what makes it both the incremental fold and the store the
/// [`FoldEvent`]s borrow from. See the module docs for why the
/// machine rather than a batch fold.
///
/// Frames must be pushed in log order. A machine only ever grows, so a caller
/// tracking a live session keeps one per session and pushes for as long as
/// the session lasts.
#[derive(Debug, Default)]
pub struct FoldMachineImpl {
    state: FoldState,
}

impl FoldMachineImpl {
    /// A machine that has folded nothing.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Every message derived so far, oldest first.
    ///
    /// Includes the open turn's agent message, still being appended to. There
    /// is nothing to finalize: a message is complete the moment no further
    /// frame touches it.
    #[must_use]
    pub fn messages(&self) -> &[FoldedMessage] {
        &self.state.messages
    }

    /// Every message derived so far, giving up the machine.
    #[must_use]
    pub fn into_messages(self) -> Vec<FoldedMessage> {
        self.state.messages
    }

    /// Turn id the next prompt pushed into this machine will open.
    #[must_use]
    pub fn next_turn_id(&self) -> TurnId {
        TurnId(self.state.turns_opened)
    }

    /// Session-level state derived so far, for callers that want state
    /// rather than [`FoldEvent::MetadataUpdated`] changes.
    #[must_use]
    pub fn metadata(&self) -> &SessionMetadata {
        &self.state.metadata
    }
}

impl FoldMachine for FoldMachineImpl {
    fn push(&mut self, log: AgentSessionLog) -> Vec<FoldEvent<'_>> {
        let changes = self.state.step(log);
        changes
            .into_iter()
            .filter_map(|change| match change {
                StepChange::Message(changed) => {
                    self.state
                        .messages
                        .get(changed.message)
                        .map(|message| match changed.kind {
                            Change::New => FoldEvent::NewMessage(Cow::Borrowed(message)),
                            Change::Updated => FoldEvent::MessageUpdate(Cow::Borrowed(message)),
                        })
                }
                StepChange::Metadata => Some(FoldEvent::MetadataUpdated(Cow::Borrowed(
                    &self.state.metadata,
                ))),
            })
            .collect()
    }
}

impl<T: LogRepo + Sync> FoldSession for T {
    /// Read the session's log through [`LogRepo`] and fold it.
    ///
    /// The one place [`fold`] meets storage: everywhere else in this crate
    /// only knows how to fold an iterator, never where it came from.
    async fn fold_session(
        &self,
        session: AgentSessionId,
    ) -> Result<Vec<FoldedMessage>, rootcause::Report> {
        let log = self.list_by_session(session).await?;
        Ok(fold(log))
    }

    async fn next_turn_id(&self, session: AgentSessionId) -> Result<TurnId, rootcause::Report> {
        let log = self.list_by_session(session).await?;
        Ok(fold_machine(log).next_turn_id())
    }
}
