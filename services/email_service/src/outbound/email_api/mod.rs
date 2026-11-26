//! Email API infrastructure adapters.

mod gmail;
mod gmail_gate;
pub mod imap;
mod microsoft;
mod token_source;

pub use email_api_client::outbound::microsoft_gate::RedisMicrosoftRequestGate;
pub use gmail::{GmailApi, GmailAttachmentGateway};
pub use gmail_gate::{RateBudget, RedisGmailRequestGate};
pub use microsoft::{MicrosoftCredentialsClient, ProviderMailboxGateway};
pub use token_source::{EmailServiceTokenSource, StaticTokenSource};
