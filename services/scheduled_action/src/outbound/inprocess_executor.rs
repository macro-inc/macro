pub mod agent_task;
mod notify;

// Preserve the adapter-facing construction path while execution policy lives in domain.
pub use crate::domain::execution::InProcessExecutor;

#[cfg(test)]
mod test;
