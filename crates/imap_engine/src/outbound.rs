//! Concrete persistence, credential encryption and mail transport adapters.
pub mod crypto;
pub mod discovery;
pub mod network;
pub mod postgres;
pub mod protocol;
pub mod provider_hint;

/// Internal wakeup delivery.
pub mod notifications;
