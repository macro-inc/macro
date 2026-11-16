//! Domain layer: the activity model, storage and realtime ports, and the
//! realtime distribution service.

#[cfg(feature = "reads")]
pub mod activity_range;
pub mod events;
pub mod models;
pub mod overview;
pub mod ports;
#[cfg(feature = "realtime")]
pub mod realtime;
#[cfg(feature = "reads")]
pub mod service;
pub mod timeline;

#[cfg(feature = "consumer")]
pub mod announcements;
#[cfg(feature = "consumer")]
pub mod materializer;
