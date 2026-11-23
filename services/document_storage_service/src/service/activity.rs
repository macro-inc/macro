//! Composition root for the activity consumer.
//!
//! DSS is the one place that legitimately knows every domain, so it declares
//! which topics feed activity and dispatches each decoded event to the
//! owning domain's mapping. All semantics live in the domain crates; all
//! machinery lives in the `activity` crate. These arms are pure wiring.

use activity::Ingest;
use agent_session::domain::events::AgentSessionLifecycleMacroEvent;
use call::domain::events::CallMacroEvent;
use channels::domain::broker_events::ChannelMacroEvent;
use chat::domain::events::ChatMacroEvent;
use databases::domain::events::DatabaseMacroEvent;
use documents_hex::domain::events::DocumentMacroEvent;
use email::domain::events::EmailMacroEvent;
use forms::domain::events::FormMacroEvent;
use initiative::domain::events::InitiativeMacroEvent;
use macro_event_broker::MacroEvent as _;
use messages::outbound::broker::MessageMacroEvent;
use projects_hex::domain::events::ProjectMacroEvent;
use properties::domain::events::PropertyMacroEvent;
use time_tracking::domain::events::TimeEntryMacroEvent;

#[allow(clippy::enum_variant_names)]
mod source {
    use super::*;

    macro_event_broker::declare_topics!(
        ActivitySourceEvent:
            DocumentMacroEvent,
            ChannelMacroEvent,
            MessageMacroEvent,
            ChatMacroEvent,
            ProjectMacroEvent,
            EmailMacroEvent,
            PropertyMacroEvent,
            CallMacroEvent,
            InitiativeMacroEvent,
            DatabaseMacroEvent,
            FormMacroEvent,
            AgentSessionLifecycleMacroEvent,
            TimeEntryMacroEvent,
    );
}
pub(crate) use source::ActivitySourceEvent;

mod timeline;
pub(crate) use timeline::TimelinePublisher;

/// Dispatches each event to its owning domain. Document editing sessions use
/// the shared inactivity store; all classification and debounce policy stays
/// in the documents domain.
pub(crate) async fn ingest(
    event: ActivitySourceEvent,
    editing_activity: &impl documents_hex::domain::ports::EditingActivityStore,
) -> Ingest {
    fn arm<E: activity::ActivitySource>(envelope: &macro_event_broker::Event<E>) -> Ingest {
        envelope.event.ingest(envelope.event_id)
    }

    let correlation = event.agent_correlation_id();
    agent_correlation::context::scope(correlation, async {
        match event {
            ActivitySourceEvent::DocumentMacroEvent(e) => {
                let envelope = e.event();
                documents_hex::domain::activity::ingest_with_editing_sessions(
                    &envelope.event,
                    envelope.event_id,
                    editing_activity,
                )
                .await
            }
            ActivitySourceEvent::ChannelMacroEvent(e) => arm(e.event()),
            ActivitySourceEvent::MessageMacroEvent(e) => {
                let envelope = e.event();
                channels::domain::activity::ingest_message_event(envelope.event_id, &envelope.event)
            }
            ActivitySourceEvent::ChatMacroEvent(e) => arm(e.event()),
            ActivitySourceEvent::ProjectMacroEvent(e) => arm(e.event()),
            ActivitySourceEvent::EmailMacroEvent(e) => arm(e.event()),
            ActivitySourceEvent::PropertyMacroEvent(e) => arm(e.event()),
            ActivitySourceEvent::CallMacroEvent(e) => arm(e.event()),
            ActivitySourceEvent::InitiativeMacroEvent(e) => arm(e.event()),
            ActivitySourceEvent::DatabaseMacroEvent(e) => arm(e.event()),
            ActivitySourceEvent::FormMacroEvent(event) => arm(event.event()),
            ActivitySourceEvent::AgentSessionLifecycleMacroEvent(event) => arm(event.event()),
            ActivitySourceEvent::TimeEntryMacroEvent(event) => arm(event.event()),
        }
    })
    .await
}

pub(crate) use activity::outbound::entity_access_audience::EntityAccessActivityAudience;
