/// Event-to-activity mappings for this domain.
pub mod activity;
#[cfg(feature = "calendar_invitations")]
pub mod calendar_invitation_parser;
pub mod events;
#[cfg(feature = "ports")]
pub mod followup;
#[cfg(feature = "calendar_invitations")]
pub mod invitation_extraction;
#[cfg(feature = "calendar_invitations")]
pub mod invitation_resolution;
#[cfg(feature = "mailbox")]
pub mod mailbox;
pub mod models;

#[cfg(feature = "ports")]
pub mod assembler;
#[cfg(feature = "ports")]
pub mod ports;
#[cfg(feature = "ports")]
pub mod scheduled;
#[cfg(feature = "ports")]
pub mod scheduled_delivery;
#[cfg(feature = "ports")]
pub mod service;

#[cfg(feature = "ports")]
pub mod draft_attachments;

#[cfg(feature = "ports")]
pub mod attachment_cleanup;

#[cfg(feature = "mailbox")]
pub mod attachment_access;

/// Provider-neutral mailbox connection entitlements.
pub mod inbox_entitlement;

/// Atomic sender changes and retirement of the original draft.
#[cfg(feature = "mailbox")]
pub mod draft_transfer;
