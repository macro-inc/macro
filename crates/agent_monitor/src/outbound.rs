//! Source adapters: each reads one kind of local fact and sends it to the
//! store as [`Observation`](crate::domain::observation::Observation)s. All of
//! them are push-driven (a child process's stdout, or file-system
//! notifications); a 30 s reconcile only re-checks what is already known.

pub mod claude_registry;
pub mod claude_transcripts;
pub mod codex_rollouts;
pub mod demo;
pub mod hc;
pub mod local;
pub mod macrod_sessions;
pub mod managers;
mod records;
pub mod run_records;
mod tail;
#[cfg(test)]
mod test_support;
mod transcripts;
mod watch;
