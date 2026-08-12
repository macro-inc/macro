//! Composition root for the activity consumer.
//!
//! DSS is the one place that legitimately knows every domain, so it declares
//! which topics feed activity and dispatches each decoded event to the
//! owning domain's mapping. All semantics live in the domain crates; all
//! machinery lives in the `activity` crate. These arms are pure wiring.

use activity::Ingest;
use call::domain::events::CallMacroEvent;
use channels::domain::broker_events::ChannelMacroEvent;
use chat::domain::events::ChatMacroEvent;
use documents_hex::domain::events::DocumentMacroEvent;
use email::domain::events::EmailMacroEvent;
use macro_event_broker::MacroEvent as _;
use projects_hex::domain::events::ProjectMacroEvent;
use properties::domain::events::PropertyMacroEvent;

#[allow(clippy::enum_variant_names)]
mod source {
    use super::*;

    macro_event_broker::declare_topics!(
        ActivitySourceEvent:
            DocumentMacroEvent,
            ChannelMacroEvent,
            ChatMacroEvent,
            ProjectMacroEvent,
            EmailMacroEvent,
            PropertyMacroEvent,
            CallMacroEvent,
    );
}
pub(crate) use source::ActivitySourceEvent;

/// Dispatches one decoded event to its domain's [`ActivitySource`] impl —
/// every arm is the identical expression; all semantics live with the
/// domains.
pub(crate) fn ingest(event: &ActivitySourceEvent) -> Ingest {
    fn arm<E: activity::ActivitySource>(envelope: &macro_event_broker::Event<E>) -> Ingest {
        envelope.event.ingest(envelope.event_id)
    }

    match event {
        ActivitySourceEvent::DocumentMacroEvent(e) => arm(e.event()),
        ActivitySourceEvent::ChannelMacroEvent(e) => arm(e.event()),
        ActivitySourceEvent::ChatMacroEvent(e) => arm(e.event()),
        ActivitySourceEvent::ProjectMacroEvent(e) => arm(e.event()),
        ActivitySourceEvent::EmailMacroEvent(e) => arm(e.event()),
        ActivitySourceEvent::PropertyMacroEvent(e) => arm(e.event()),
        ActivitySourceEvent::CallMacroEvent(e) => arm(e.event()),
    }
}
