#![deny(missing_docs)]
// The dispatch future nests the notification ingress future inside the sweep
// inside the Lambda handler, which overflows the default query depth.
#![recursion_limit = "256"]
//! Reminder dispatch application.
//!
//! An EventBridge schedule invokes this every minute. Each invocation sweeps
//! the reminders that have come due and hands them to the notification ingress
//! queue, which owns delivery from there.
//!
//! The lambda is only a driving adapter plus a composition root: the sweep
//! itself is [`reminders::domain::service::dispatch::ReminderDispatchService`].

pub mod runtime;

pub use runtime::AppContext;
