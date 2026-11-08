//! What a routine does when it runs: a small, typed program of steps.
//!
//! A program is data: a list of steps run in order.
//!
//! - **Code** steps run TypeScript written against Macro's SDK, type-checked
//!   when it is saved; they may only make changes where they declare. Each
//!   reads the outputs of the code steps before it, and its own
//!   [`Knob`]s: values its owner changes without new code.
//! - **Agent** ("Ask AI") steps hand the run to a model or agent with
//!   instructions. A routine has at most one.
//!
//! Apps the routine requires ([`RoutineProgram::mcp_servers`]) go to its agent.
#![deny(missing_docs)]

mod contract;
mod knob;
mod model;
mod plan;
mod starters;
mod validate;

pub use contract::{CODE_STEPS, CheckFile, MAX_OUTPUT_BYTES, STEP_CONTEXT, code_version};
pub use knob::{
    EntityId, EntityKind, EntityValue, InvalidEntityId, InvalidKnobName, Knob, KnobName,
    SentenceSlot, SentenceSyntax, sentence_slots,
};
pub use model::*;
pub use plan::{CallRecord, CallStatus, StepPath, StepRecord, StepResult};
pub use starters::{STARTERS, Starter};
pub use validate::{ProgramError, limits};
