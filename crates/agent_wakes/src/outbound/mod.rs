//! Adapters implementing the wake service's ports.

pub mod clock;
pub mod postgres;
pub mod rollout;
pub mod s3;

pub use clock::SystemClock;
