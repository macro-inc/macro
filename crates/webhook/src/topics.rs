//! The broker topics the webhook system subscribes to.
//!
//! One declaration shared by both consumption paths — the durable ingestion
//! consumer (`inbound::kafka_consumer`) and the process-level SSE consumer
//! (`inbound::kafka_stream_consumer`) — so the two can never drift onto
//! different topic sets.

use crate::domain::events::WebhookMacroEvent;
use agent_trigger::domain::broker_events::AgentSessionMacroEvent;
use channels::domain::broker_events::ChannelMacroEvent;
use documents::domain::events::DocumentMacroEvent;

macro_event_broker::declare_topics!(
    DeclaredMacroEvent: DocumentMacroEvent,
    ChannelMacroEvent,
    WebhookMacroEvent,
    AgentSessionMacroEvent,
);
