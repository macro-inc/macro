//! Showing a running turn where it was asked: the agent typing, and its reply
//! as channel messages that follow the segments the session's fold reports.
//!
//! The fold says what the reply is (see [`TurnSignal::Progressed`]); the
//! presenter plan says which messages show it
//! ([`crate::domain::presenter`]); this applies the plan as the reply grows
//! and once more, with how the turn ended, when it is over. Every message's
//! id is allocated before it is first posted and kept with the turn, so
//! showing a reply again - a retried report, a recovery - updates the same
//! messages rather than posting more.
//!
//! [`TurnSignal::Progressed`]: agent_fold::domain::model::TurnSignal::Progressed

use agent_fold::domain::model::{ProjectedSegment, TurnId, TurnPhase};

use super::*;
use crate::domain::model::{AgentTypingUpdate, ReplyPresentation, VoiceStyle};
use crate::domain::presenter::{plan_messages, shape, turn_segments};
use crate::domain::queue::InFlightTurn;

/// Where a running turn speaks, when it speaks anywhere: the origin it
/// answers back into, the person it answers, and the bot it answers as.
struct Voice {
    origin: AnnounceOrigin,
    actor: MacroUserIdStr<'static>,
    bot_id: BotId,
}

impl Voice {
    /// A turn prompted from a discussion it answers into. An assignment's
    /// chip is its own surface and has no reply to show.
    fn of(flight: &InFlightTurn) -> Option<Self> {
        let origin = flight
            .announce
            .as_ref()
            .filter(|origin| !origin.reuse_origin_message)?;
        Some(Self {
            origin: origin.clone(),
            actor: flight.actor.clone()?,
            bot_id: flight.bot_id?,
        })
    }

    fn style(&self) -> VoiceStyle {
        self.origin.reply_placement.voice_style()
    }

    fn thread_id(&self) -> Option<macro_uuid::Uuid> {
        self.origin.reply_placement.thread_id(self.origin.thread_id)
    }

    /// One message of the reply showing `segments`, not yet news.
    fn presentation(
        &self,
        session_id: AgentSessionId,
        turn: TurnId,
        message_id: macro_uuid::Uuid,
        segments: Vec<ProjectedSegment>,
    ) -> ReplyPresentation {
        ReplyPresentation {
            session_id,
            bot_id: self.bot_id,
            triggered_by: self.actor.clone(),
            parent: self.origin.parent.clone(),
            thread_id: self.thread_id(),
            message_id,
            turn,
            segments,
            // A thread reply leads with its session; a private conversation's
            // messages are the session.
            link: self.style() == VoiceStyle::Turn,
            pending: false,
            outcome: None,
            notify: false,
        }
    }
}

impl<
    Sessions,
    Containers,
    Announcer,
    Runtimes,
    PromptContext,
    PromptComposer,
    Egress,
    Lifecycle,
    Mentions,
    Notifier,
>
    AgentHarnessInner<
        Sessions,
        Containers,
        Announcer,
        Runtimes,
        PromptContext,
        PromptComposer,
        Egress,
        Lifecycle,
        Mentions,
        Notifier,
    >
where
    Sessions: AgentSessionService,
    Containers: ContainerManager,
    Announcer: SessionAnnouncer,
    Runtimes: RuntimeConnections,
    PromptContext: MessagePromptContext,
    PromptComposer: AgentPromptComposer,
    Egress: SandboxEgressProvisioner,
    Lifecycle: AgentSessionLifecyclePublisher,
    Mentions: PromptMentions,
    Notifier: AgentSessionNotifier,
{
    /// The running turn a fold report is about, when this replica
    /// dispatched it. A report for any other turn - one resumed from
    /// elsewhere, one nobody here prompted - has no voice to show it in.
    fn reported_flight(
        &self,
        session_id: AgentSessionId,
        turn: TurnId,
        action_id: Option<AgentActionId>,
    ) -> Option<InFlightTurn> {
        let flight = self.busy.turn(session_id)?;
        (flight.turn == turn || action_id == Some(flight.action_id)).then_some(flight)
    }

    /// The segments last reported for `turn`, or none when this replica did
    /// not watch it run.
    pub(super) fn reported_segments(
        &self,
        session_id: AgentSessionId,
        turn: TurnId,
    ) -> Vec<ProjectedSegment> {
        self.projections
            .get(&session_id)
            .filter(|reported| reported.0 == turn)
            .map(|reported| reported.1.clone())
            .unwrap_or_default()
    }

    /// Show a running turn's reply as it now stands, and what the agent is
    /// doing. Only the session's command worker calls this, so reports for
    /// one turn are applied in the order the fold made them.
    pub(super) async fn present_progress(
        &self,
        session_id: AgentSessionId,
        turn: TurnId,
        action_id: Option<AgentActionId>,
        phase: Option<TurnPhase>,
        segments: Vec<ProjectedSegment>,
    ) {
        let Some(mut flight) = self.reported_flight(session_id, turn, action_id) else {
            return;
        };
        self.projections
            .insert(session_id, (turn, segments.clone()));
        let Some(voice) = Voice::of(&flight) else {
            return;
        };
        if let Some(phase) = phase
            && self.typing_phases.insert(session_id, phase) != Some(phase)
        {
            self.publish_typing(session_id, &flight, true).await;
        }
        // A closed reply is shown once, with how its turn ended, by the
        // turn's end - which arrives right behind this report.
        if phase.is_none() {
            return;
        }
        match voice.style() {
            VoiceStyle::Turn => {
                // A chip renders the turn itself; there is no reply to grow.
                if flight.speaks_as_chip {
                    return;
                }
                let Some(message_id) = flight.announcement_message_id else {
                    return;
                };
                let shown = turn_segments(&segments);
                // The pending reply already says the turn is running; until
                // there is something to add to it, it is left alone.
                let untouched = !self.presented_shapes.contains_key(&message_id);
                if (untouched && shown.is_empty()) || !self.shows_differently(message_id, &shown) {
                    return;
                }
                let mut presentation = voice.presentation(session_id, turn, message_id, shown);
                presentation.pending = true;
                self.present_reply(presentation).await;
            }
            VoiceStyle::Segments => {
                let planned = plan_messages(&segments);
                if let Err(error) = self
                    .allocate_reply_messages(session_id, &mut flight, planned.len())
                    .await
                {
                    tracing::error!(?error, %session_id, "could not keep a reply's message ids; not showing it yet");
                    return;
                }
                for (message, message_id) in planned.into_iter().zip(flight.presented.clone()) {
                    if !message.ready || !self.shows_differently(message_id, &message.segments) {
                        continue;
                    }
                    let presentation =
                        voice.presentation(session_id, turn, message_id, message.segments);
                    self.present_reply(presentation).await;
                }
            }
        }
    }

    /// Show a reply in segments once its turn has ended: every message it
    /// takes, the last one with how the turn ended and as news.
    ///
    /// Returns whether everything was shown, for the durable reply record.
    pub(super) async fn present_final(
        &self,
        session_id: AgentSessionId,
        flight: &InFlightTurn,
        outcome: ReplyOutcome,
    ) -> bool {
        let Some(voice) = Voice::of(flight) else {
            return true;
        };
        let planned = plan_messages(&self.reported_segments(session_id, flight.turn));
        if planned.is_empty() {
            // Nothing the reply said or did can be shown, so say how the
            // turn ended. Without the reply's segments - this replica did
            // not watch it run - an answer may already be showing in
            // messages posted before, and is not repeated; a notice that
            // the turn failed or stopped is.
            if !flight.presented.is_empty() && matches!(outcome, ReplyOutcome::Answered(_)) {
                return true;
            }
            let mut presentation = voice.presentation(
                session_id,
                flight.turn,
                macro_uuid::generate_uuid_v7(),
                Vec::new(),
            );
            presentation.outcome = Some(outcome);
            presentation.notify = true;
            return self.present_reply(presentation).await;
        }
        let mut ids = flight.presented.clone();
        while ids.len() < planned.len() {
            ids.push(macro_uuid::generate_uuid_v7());
        }
        let last = planned.len() - 1;
        let mut presented = true;
        for (index, (message, message_id)) in planned.into_iter().zip(ids).enumerate() {
            let closing = index == last;
            if !closing && !self.shows_differently(message_id, &message.segments) {
                continue;
            }
            let mut presentation =
                voice.presentation(session_id, flight.turn, message_id, message.segments);
            if closing {
                presentation.outcome = Some(outcome.clone());
                presentation.notify = true;
            }
            presented &= self.present_reply(presentation).await;
        }
        presented
    }

    /// Give every message a reply needs an id, and keep the ids with the
    /// turn before any message is posted under one.
    async fn allocate_reply_messages(
        &self,
        session_id: AgentSessionId,
        flight: &mut InFlightTurn,
        count: usize,
    ) -> agent_session::domain::error::Result<()> {
        if flight.presented.len() >= count {
            return Ok(());
        }
        while flight.presented.len() < count {
            flight.presented.push(macro_uuid::generate_uuid_v7());
        }
        // Downstream events name the reply's latest message.
        flight.announcement_message_id = flight.presented.last().copied();
        if let Some(store) = &self.dm_turns {
            store.record_flight(flight.action_id, flight).await?;
        }
        self.busy.mark_turn(session_id, flight.clone());
        Ok(())
    }

    /// Whether `segments` would show differently from what `message_id`
    /// last showed.
    fn shows_differently(
        &self,
        message_id: macro_uuid::Uuid,
        segments: &[ProjectedSegment],
    ) -> bool {
        self.presented_shapes
            .get(&message_id)
            .is_none_or(|shown| *shown != shape(segments))
    }

    /// Post or update one reply message. Best-effort like every reply: a
    /// failure leaves the message as it was, and the turn's end shows the
    /// reply again.
    async fn present_reply(&self, presentation: ReplyPresentation) -> bool {
        let message_id = presentation.message_id;
        let shown = shape(&presentation.segments);
        match self.announcer.present(presentation).await {
            Ok(()) => {
                self.presented_shapes.insert(message_id, shown);
                true
            }
            Err(error) => {
                tracing::error!(?error, %message_id, "failed to show an agent reply message");
                false
            }
        }
    }

    /// Say that a running turn's agent is typing, or that it stopped.
    pub(super) async fn publish_typing(
        &self,
        session_id: AgentSessionId,
        flight: &InFlightTurn,
        active: bool,
    ) {
        let Some(voice) = Voice::of(flight) else {
            return;
        };
        let phase = self
            .typing_phases
            .get(&session_id)
            .map_or(TurnPhase::Thinking, |phase| *phase);
        let update = AgentTypingUpdate {
            session_id,
            bot_id: voice.bot_id,
            triggered_by: voice.actor.clone(),
            parent: voice.origin.parent.clone(),
            thread_id: voice.thread_id(),
            active,
            phase,
        };
        if let Err(error) = self.announcer.typing(update).await {
            tracing::debug!(?error, %session_id, "failed to publish an agent typing");
        }
    }

    /// Stop a finished turn's typing and forget what its reply showed.
    pub(super) async fn end_presentation(
        &self,
        session_id: AgentSessionId,
        flight: Option<&InFlightTurn>,
    ) {
        if let Some(flight) = flight {
            self.publish_typing(session_id, flight, false).await;
            for id in flight
                .presented
                .iter()
                .chain(&flight.announcement_message_id)
            {
                self.presented_shapes.remove(id);
            }
        }
        self.typing_phases.remove(&session_id);
        self.projections.remove(&session_id);
    }
}

impl<
    Sessions,
    Containers,
    Announcer,
    Runtimes,
    PromptContext,
    PromptComposer,
    Egress,
    Lifecycle,
    Mentions,
    Notifier,
>
    AgentHarnessService<
        Sessions,
        Containers,
        Announcer,
        Runtimes,
        PromptContext,
        PromptComposer,
        Egress,
        Lifecycle,
        Mentions,
        Notifier,
    >
where
    Sessions: AgentSessionService,
    Containers: ContainerManager,
    Announcer: SessionAnnouncer,
    Runtimes: RuntimeConnections,
    PromptContext: MessagePromptContext,
    PromptComposer: AgentPromptComposer,
    Egress: SandboxEgressProvisioner,
    Lifecycle: AgentSessionLifecyclePublisher,
    Mentions: PromptMentions,
    Notifier: AgentSessionNotifier,
{
    /// Refresh the typing indicator of every turn running on this replica.
    ///
    /// Viewers drop an indicator nobody refreshes, so this runs on a timer
    /// shorter than their timeout, and a turn whose replica died stops
    /// showing as typing on its own.
    pub async fn refresh_typing(&self) {
        for (session_id, flight) in self.inner.busy.running() {
            self.inner.publish_typing(session_id, &flight, true).await;
        }
    }
}
