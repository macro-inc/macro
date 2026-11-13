//! [`WriterSwitches`] over service feature flags.

use crate::domain::log_writer::WriterSwitches;
use feature_flags::{ServiceContext, ServiceFeatureFlags};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Stops the writer when enabled.
pub const LOG_KILL_SWITCH_FLAG: &str = "public-event-log-kill-switch";
/// Appends the email family when enabled.
pub const LOG_EMAIL_FLAG: &str = "public-event-log-email";
/// The service context the writer evaluates under.
pub const LOG_WRITER_CONTEXT: ServiceContext = ServiceContext::new("public-event-log-writer");

/// How long one evaluation is reused.
const REFRESH: Duration = Duration::from_secs(30);

#[derive(Clone, Copy)]
struct Switches {
    killed: bool,
    email: bool,
}

/// Evaluates the writer's switches at most every [`REFRESH`]. A failed
/// evaluation keeps the last answer (initially: writing, email off).
pub struct FlagWriterSwitches<F> {
    flags: F,
    state: Arc<Mutex<(Switches, Option<Instant>)>>,
}

impl<F> FlagWriterSwitches<F> {
    /// Evaluate through `flags`.
    pub fn new(flags: F) -> Self {
        Self {
            flags,
            state: Arc::new(Mutex::new((
                Switches {
                    killed: false,
                    email: false,
                },
                None,
            ))),
        }
    }
}

impl<F: ServiceFeatureFlags + 'static> FlagWriterSwitches<F> {
    async fn current(&self) -> Switches {
        let (switches, loaded) = *self
            .state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if loaded.is_some_and(|at| at.elapsed() < REFRESH) {
            return switches;
        }
        let switches = match self.flags.load_service(LOG_WRITER_CONTEXT).await {
            Ok(snapshot) => Switches {
                killed: snapshot.is_enabled(LOG_KILL_SWITCH_FLAG),
                email: snapshot.is_enabled(LOG_EMAIL_FLAG),
            },
            Err(error) => {
                tracing::warn!(error = ?error, "failed to evaluate the public event log switches; keeping the last answer");
                switches
            }
        };
        *self
            .state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = (switches, Some(Instant::now()));
        switches
    }
}

impl<F: ServiceFeatureFlags + 'static> WriterSwitches for FlagWriterSwitches<F> {
    async fn writer_enabled(&self) -> bool {
        !self.current().await.killed
    }

    async fn email_enabled(&self) -> bool {
        self.current().await.email
    }
}
