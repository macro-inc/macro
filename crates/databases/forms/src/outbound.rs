//! Driven adapters: the Postgres repository, the system clock, the forms
//! catalog asked of `entity_access`, liveness through the gateway, and the
//! static files branding shows.

pub mod collaborative_layout;
pub mod entity_access_directory;
#[cfg(feature = "gateway")]
pub mod gateway_event_publisher;
#[cfg(feature = "postgres")]
pub mod pg_forms_repo;
#[cfg(feature = "static_files")]
pub mod static_file_images;
pub mod system_clock;

/// Authoring permission adapter.
pub mod authoring_access;
/// Authorized scheduling destination adapter.
#[cfg(feature = "scheduling")]
pub mod authoring_booking;

/// Shared AI editing worker adapter.
pub mod authoring_editor;
