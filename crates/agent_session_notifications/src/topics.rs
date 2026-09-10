//! The one broker topic this crate subscribes to.

use agent_session::domain::events::AgentSessionLifecycleMacroEvent;

macro_event_broker::declare_topics!(DeclaredMacroEvent: AgentSessionLifecycleMacroEvent,);
