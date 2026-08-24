//! Outbound adapters for channel bot dependencies.

mod agent_loop_responder;
mod fast_model_trigger_classifier;

pub use agent_loop_responder::AgentLoopResponder;
pub use fast_model_trigger_classifier::FastModelTriggerClassifier;
