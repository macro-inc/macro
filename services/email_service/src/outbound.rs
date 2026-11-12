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
/// Authorized provider downloads of original message source (`.eml`).
pub mod message_source;

/// Forwarded-attachment persistence facts.
pub mod forwarded_attachments;
pub mod mailbox_settings;
/// Provider reads of a user's newest inbox messages.
pub mod recent_inbox;

/// Atomic message-label batch persistence and undo.
pub mod message_labels;
/// Stored facts for the legacy message and thread read use cases.
pub mod message_reads;

/// Calendar-domain removal of an authorized inbox's calendar.
pub mod calendar_disconnect;
/// Basic inbox and delegation facts.
pub mod inbox_access;
/// Stored sent-message contacts for an inbox.
pub mod inbox_contacts;
/// Original legacy operation errors retained across domain ports.
pub mod persistence_error;
/// Stored scheduled drafts for an inbox.
pub mod scheduled_drafts;
/// Existing settings, signature image, and Gmail alias effects.
pub mod signature_settings;

/// Backfill-job persistence and initialization publication.
pub mod backfill_jobs;
pub mod gmail_push;
pub mod inbox_connection;
pub mod user_deletion;
