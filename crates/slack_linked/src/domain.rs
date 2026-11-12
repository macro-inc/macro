/// What the session service hands the domain.
pub mod events;
/// Account, sign-in and catalogue models shared with the web app.
pub mod models;

/// Port traits.
#[cfg(feature = "ports")]
pub mod ports;
/// Slack as an external chat provider.
#[cfg(feature = "ports")]
pub mod provider;
/// DSS use cases: sign-in, accounts and the catalogue.
#[cfg(feature = "ports")]
pub mod service;
/// In-process API for the session service.
#[cfg(feature = "ports")]
pub mod session;
