//! Email API infrastructure adapters.

mod microsoft;
mod rate_limiter;
mod token_source;

pub use email_api_client::outbound::microsoft_gate::RedisMicrosoftRequestGate;
pub use microsoft::{MicrosoftCredentialsClient, ProviderMailboxGateway};
pub use rate_limiter::{RateBudget, RedisProviderRateLimiter};
pub use token_source::{EmailServiceTokenSource, StaticTokenSource};

use email_api_client::GmailApiClientRepository;
use email_api_client::domain::service::EmailApiClientServiceImpl;

/// Gmail API service composed with email-service infrastructure adapters.
pub type GmailApi = EmailApiClientServiceImpl<
    GmailApiClientRepository,
    EmailServiceTokenSource,
    RedisProviderRateLimiter,
>;
