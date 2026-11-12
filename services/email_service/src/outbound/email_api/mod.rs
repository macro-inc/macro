//! Email API infrastructure adapters.

mod gmail_gate;
mod microsoft;
mod token_source;

pub use email_api_client_outbound::microsoft_gate::RedisMicrosoftRequestGate;
pub use gmail_gate::{RateBudget, RedisGmailRequestGate};
pub use microsoft::{MicrosoftCredentialsClient, ProviderMailboxGateway};
pub use token_source::{EmailServiceTokenSource, StaticTokenSource};

use email_api_client_core::service::EmailApiClientServiceImpl;
use email_api_client_outbound::GmailApiClientRepository;

/// Gmail API service composed with email-service infrastructure adapters.
pub type GmailApi = EmailApiClientServiceImpl<
    GmailApiClientRepository,
    EmailServiceTokenSource,
    RedisGmailRequestGate,
>;
