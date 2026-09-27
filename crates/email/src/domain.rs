/// Event-to-activity mappings for this domain.
pub mod activity;
#[cfg(feature = "calendar_invitations")]
pub mod calendar_invitation_parser;
pub mod events;
#[cfg(feature = "calendar_invitations")]
pub mod invitation_extraction;
#[cfg(feature = "calendar_invitations")]
pub mod invitation_resolution;
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
