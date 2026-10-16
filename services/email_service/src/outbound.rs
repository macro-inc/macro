//! Outbound infrastructure adapters.
/// Email-owned invitation extraction.
pub mod invitation_extraction;

/// Email provider API adapters and composition types.
pub mod email_api;
/// Frozen content and attachment inputs for durable Outlook draft work.
pub mod mailbox_drafts;
/// Verified mailbox setup storage and authentication adapters.
pub mod mailbox_init;
/// Durable email projections to search, notifications, contacts and storage.
pub mod mailbox_projection;
/// Persistence and provider adapters for scheduled-delivery claims.
pub mod scheduled_delivery;

/// Presigned draft uploads with provider-independent validation.
pub mod draft_attachment_storage;

/// Authorized provider attachment downloads and document storage.
pub mod attachment_access;
pub mod contact_photos;
pub mod inbox_catalog;
pub mod inbox_health;
pub mod inbox_lifecycle;

pub mod mailbox_settings;
