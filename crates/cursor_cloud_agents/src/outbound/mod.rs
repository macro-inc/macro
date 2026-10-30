//! Driven adapters other than the Cursor API client.

/// Fetches pasted links that turn out to be images.
pub mod http_prompt_images;
/// Process-local journal for standalone agents and tests.
pub mod memory_journal;
/// Fenced durable journal for hosted sessions.
#[cfg(feature = "postgres")]
pub mod postgres_journal;
/// Re-hosts artifacts on Macro's static file service.
pub mod static_file_artifacts;
