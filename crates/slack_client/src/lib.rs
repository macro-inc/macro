//! A typed client for the Slack web client's session API: the `xoxc-` token
//! and `d` cookie a browser holds, the Web API methods a chat client needs,
//! email login, and the real-time websocket.
//!
//! It owns no Macro concepts; it is an outbound adapter library. Tests drive
//! it against `slack_fake_server`.
#![deny(missing_docs)]

pub mod api;
mod client;
mod credentials;
mod endpoints;
mod error;
mod ids;
pub mod login;
mod method;
pub mod models;
mod pacing;
pub mod realtime;

pub use client::{DownloadedFile, SlackClient};
pub use credentials::{CookieToken, InvalidCredential, Secret, SessionCredentials, SessionToken};
pub use endpoints::{SlackEndpoints, SlackWorkspace};
pub use error::{SlackError, SlackErrorCode};
pub use ids::{
    AppId, BotId, ChannelId, EnterpriseId, FileId, InvalidId, MessageTs, TeamId, UserGroupId,
    UserId,
};
pub use method::{RateTier, SlackMethod};
#[cfg(test)]
mod test;
