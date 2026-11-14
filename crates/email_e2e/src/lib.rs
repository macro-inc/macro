//! End-to-end tests of email: the real `email_service` and `pubsub_workers`
//! binaries running against the Gmail and Outlook emulators, driven the way
//! a user and a provider drive them.
//!
//! A scenario starts a [`Stack`], creates a [`User`], links an [`Inbox`] and
//! then acts on both sides: at the provider through the inbox's provider
//! methods or the emulators themselves ([`Stack::gmail`],
//! [`Stack::outlook`]), and in Macro through the email API. It observes the
//! outcome the same way, waiting with the inbox's `wait_for_*` methods or
//! [`eventually`]. `AGENTS.md` shows how to write one.
#![deny(missing_docs)]

mod api;
mod aws;
mod email_tools;
mod inbox;
mod infra;
mod lambda;
mod macro_services;
mod process;
mod provider_catalog;
mod stack;
mod tls;
mod user;
mod wait;

pub use api::ApiResponse;
pub use aws::StoredObject;
pub use email_tools::EmailTools;
/// The Gmail emulator's own API, for what the inbox methods do not cover.
pub use gmail_emulator;
pub use inbox::{Inbox, Mail, MailAttachment, Provider, ProviderMessage};
pub use macro_services::{HeldRequest, ServiceRequest};
/// The Outlook emulator's own API, for what the inbox methods do not cover.
pub use outlook_emulator;
/// The Redis client [`Stack::redis`] answers with.
pub use redis;
/// The error type every harness method returns.
pub use rootcause::Report;
pub use stack::{Stack, StackOptions};
pub use user::User;
pub use wait::{DEFAULT_TIMEOUT, eventually};
