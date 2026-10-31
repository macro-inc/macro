//! What a routine does when it runs: a small, typed program of steps.
//!
//! A program is data. It mixes four kinds of step:
//!
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

mod model;
mod plan;
pub mod template;
mod validate;

pub use model::*;
pub use plan::{
    AnswerMismatch, CONDITION_THRESHOLD, PlannedStep, StepPath, StepRecord, StepResult,
    choice_question,
};
pub use validate::{ProgramError, ProgramSummary, limits};
