//! One lifecycle for an agent teammate, hosted or in a container
//! (docs/design/teammate-runtime.md, *Lifecycle controller*).
//!
//! - [`boot`]: what `teammate-boot` decides at each start, inside the
//!   sandbox: count the last run, roll the code back, adopt the image's
//!   lock, or refuse to start.
//! - [`supervisor`]: what the supervisor in macrod does after each exit.
//! - [`replacement`]: how the container backend swaps an image, and rolls
//!   back to the previous one.
//! - [`runner`] (Unix only): the effects of a boot, behind the [`runner::Git`],
//!   [`runner::Fs`] and [`runner::Runtime`] ports.
//!
//! [`exit`] holds the one exit-code table both sides read.
#![deny(missing_docs)]

pub mod boot;
pub mod exit;
pub mod replacement;
#[cfg(unix)]
pub mod runner;
pub mod supervisor;
