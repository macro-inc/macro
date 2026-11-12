/// Event-to-activity mappings for this domain.
pub mod activity;
#[cfg(feature = "calendar_invitations")]
pub mod calendar_invitation_parser;
#[cfg(all(feature = "calendar_invitations", feature = "ports"))]
pub mod event_forward;
pub mod events;
#[cfg(feature = "ports")]
pub mod focus;
#[cfg(feature = "ports")]
pub mod followup;
#[cfg(feature = "ports")]
pub mod forwarded_attachments;
#[cfg(feature = "calendar_invitations")]
pub mod invitation_extraction;
#[cfg(feature = "calendar_invitations")]
pub mod invitation_import;
#[cfg(feature = "calendar_invitations")]
pub mod invitation_resolution;
#[cfg(feature = "mailbox")]
pub mod mailbox;
/// Optimistic message-label batches and provider-write compensation.
#[cfg(feature = "ports")]
pub mod message_labels;
/// Synced message and thread reads with their legacy access and pagination policies.
#[cfg(feature = "mailbox")]
pub mod message_reads;
pub mod models;
#[cfg(feature = "ports")]
pub mod read_receipts;
/// A user's newest inbox messages, read straight from the providers.
#[cfg(feature = "mailbox")]
pub mod recent_inbox;
pub mod senders;
pub mod shared_thread_replies;

#[cfg(feature = "ports")]
pub mod assembler;
#[cfg(feature = "ports")]
pub mod ports;
#[cfg(feature = "ports")]
pub mod scheduled;
#[cfg(feature = "ports")]
pub mod scheduled_delivery;
#[cfg(feature = "ports")]
pub mod send_attempt;
#[cfg(feature = "ports")]
pub mod service;

#[cfg(feature = "ports")]
pub mod draft_attachments;

#[cfg(feature = "ports")]
pub mod attachment_cleanup;

#[cfg(feature = "mailbox")]
pub mod attachment_access;

/// Authorized original-source (`.eml`) reads of synced messages.
#[cfg(feature = "mailbox")]
pub mod message_source;

/// Provider-neutral mailbox connection entitlements.
pub mod inbox_entitlement;

/// Atomic sender changes and retirement of the original draft.
#[cfg(feature = "mailbox")]
pub mod draft_transfer;
