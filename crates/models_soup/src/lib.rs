//! Shared API models for the Soup feed.

#![deny(missing_docs)]

/// Call record models for Soup responses.
pub mod call_record;
/// Chat models for Soup responses.
pub mod chat;
/// Channel and channel message models for Soup responses.
pub mod comms;
/// CRM company models for Soup responses.
pub mod crm_company;
/// Document models for Soup responses.
pub mod document;
/// Email thread models for Soup responses.
pub mod email_thread;
/// Foreign entity models for Soup responses.
pub mod foreign_entity;
/// Unified Soup feed item model.
pub mod item;
/// Project models for Soup responses.
pub mod project;
/// Property models attached to Soup items.
pub mod properties;

pub use properties::SoupProperty;
