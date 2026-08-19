//! Domain layer: the activity model, storage and realtime ports, and the
//! realtime distribution service.

pub mod events;
pub mod models;
pub mod ports;
#[cfg(feature = "realtime")]
pub mod realtime;
