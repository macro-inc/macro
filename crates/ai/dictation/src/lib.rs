//! Private, transient audio transcription for composer dictation.
//!
//! Hexagonal layout: [`domain`] owns recording validation, the provider port,
//! and the use case; [`inbound`] exposes the authenticated, rate-limited HTTP
//! endpoint; [`outbound`] implements the port with OpenAI Whisper.
#![deny(missing_docs)]

pub mod domain;
#[cfg(feature = "inbound")]
pub mod inbound;
#[cfg(feature = "outbound")]
pub mod outbound;
