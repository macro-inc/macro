//! Domain layer: the activity model, storage and realtime ports, and the
//! realtime distribution service.

pub mod events;
pub mod models;
pub mod overview;
pub mod ports;
#[cfg(feature = "ai_tools")]
pub mod service;
#[cfg(feature = "realtime")]
pub mod realtime;
