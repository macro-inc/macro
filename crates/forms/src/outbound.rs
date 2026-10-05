//! Driven adapters: the Postgres repository, the system clock, the forms
//! catalog asked of `entity_access`, and liveness through the gateway.

pub mod collaborative_layout;
pub mod entity_access_directory;
#[cfg(feature = "gateway")]
pub mod gateway_event_publisher;
#[cfg(feature = "postgres")]
pub mod pg_forms_repo;
pub mod system_clock;
