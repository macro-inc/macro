//! Source adapters: each reads one kind of local fact and sends it to the
//! store as [`Observation`](crate::domain::observation::Observation)s. All but
//! one are push-driven (a child process's stdout, or file-system
//! notifications; a 30 s reconcile only re-checks what is already known);
//! [`github`] polls GitHub for pull request status.

pub mod claude_registry;
pub mod claude_transcripts;
pub mod codex_rollouts;
pub mod demo;
pub mod github;
pub mod hc;
pub mod local;
pub mod macrod_sessions;
pub mod managers;
mod pr_create;
mod records;
pub mod run_records;
mod tail;
#[cfg(test)]
mod test_support;
pub mod transcript_feed;
mod transcripts;
mod watch;
