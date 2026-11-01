//! What a routine does when it runs: a small, typed program of steps.
//!
//! A program is data. It mixes five kinds of step:
//!
//! - **Code** steps run TypeScript written against Macro's SDK, type-checked
//!   when it is saved; they may only make changes where they declare.
//! - **Tool** steps call one tool from Macro's catalog with fixed arguments,
//!   the same tools agents use, so they behave exactly the same way.
//! - **If** steps ask a yes/no question about the triggering item.
//! - **Choose** steps pick the option that best describes the triggering item.
//! - **Agent** steps hand the run to a model or agent with instructions.
//!
//! Every decision is asked about the triggering content in one classifier
//! round trip before anything runs ([`RoutineProgram::questions`]). Tool
//! outputs never change control flow, so once the answers are known the steps
//! to run form a plain list ([`RoutineProgram::resolve`]). String arguments
//! can embed `{{trigger.…}}` and `{{steps.<id>.…}}` placeholders ([`template`]).
//! Apps the routine requires ([`RoutineProgram::mcp_servers`]) go to its agent.
#![deny(missing_docs)]

mod contract;
mod model;
mod plan;
pub mod template;
mod validate;

pub use contract::{CODE_STEPS, CheckFile, MAX_OUTPUT_BYTES, STEP_CONTEXT, code_version};
pub use model::*;
pub use plan::{
    AnswerMismatch, CONDITION_THRESHOLD, CallRecord, CallStatus, PlannedStep, StepPath, StepRecord,
    StepResult, choice_question,
};
pub use validate::{ProgramError, ProgramSummary, limits};
