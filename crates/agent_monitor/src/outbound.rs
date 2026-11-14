//! Source adapters: each reads one kind of local fact and sends it to the
//! store as [`Observation`](crate::domain::observation::Observation)s. All of
//! them are push-driven (a child process's stdout, or file-system
//! notifications); a 30 s reconcile only re-checks what is already known.

pub mod hc;
mod tail;
mod watch;
