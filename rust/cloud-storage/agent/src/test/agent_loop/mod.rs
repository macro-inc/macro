//! Behavior tests for the agent loop, grouped by guarantee.
//!
//! Shared setup lives in [`util`]; each `test_*` module asserts one family of
//! guarantees against the public session surface.

mod util;

mod test_cooperative_cancellation;
mod test_eager_tools;
mod test_tool;
