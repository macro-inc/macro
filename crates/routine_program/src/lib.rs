//! What a routine does when it runs: a small, typed program of steps.
//!
//! A program is data: a list of steps run in order.
//!
//! - **Code** steps run TypeScript written against Macro's SDK, type-checked
//!   when it is saved; they may only make changes where they declare.
//! - **Tool** steps call one tool from Macro's catalog with fixed arguments,
//!   the same tools agents use, so they behave exactly the same way.
//! - **Agent** steps hand the run to a model or agent with instructions.
//!
//! String arguments can embed `{{trigger.…}}` and `{{steps.<id>.…}}`
//! placeholders ([`template`]). Apps the routine requires
//! ([`RoutineProgram::mcp_servers`]) go to its agent.
#![deny(missing_docs)]

mod contract;
mod model;
mod plan;
pub mod template;
mod validate;

pub use contract::{CODE_STEPS, CheckFile, MAX_OUTPUT_BYTES, STEP_CONTEXT, code_version};
pub use model::*;
pub use plan::{CallRecord, CallStatus, StepPath, StepRecord, StepResult};
pub use validate::{ProgramError, ProgramSummary, limits};
