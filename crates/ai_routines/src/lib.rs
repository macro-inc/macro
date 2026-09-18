#![deny(missing_docs)]
//! AI routines: agent tasks a user defines once and that run on a trigger
//! rather than on a prompt typed into a surface.
//!
//! Today the only trigger is the cron scheduler in `services/scheduled_action`,
//! which publishes a run request to
//! [`MacroAiRoutinesTopic`](macro_event_topics::MacroAiRoutinesTopic) for the
//! agent trigger consumer to act on. This crate owns that wire contract so the
//! producer and the consumer share one definition.

pub mod domain;

pub use domain::events::{
    AiRoutineMacroEvent, AiRoutineRunRequested, AiRoutineTopicEvent, AiRoutineTrigger,
};
