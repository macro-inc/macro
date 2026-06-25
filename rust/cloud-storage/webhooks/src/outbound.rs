//! Outbound adapters: concrete implementations of the domain ports.

/// AES-256-GCM implementation of [`crate::domain::ports::SecretEncryptor`].
pub mod aes_secret_encryptor;
/// DNS-resolving implementation of [`crate::domain::ports::EndpointValidator`].
pub mod dns_endpoint_validator;
/// PostgreSQL implementation of [`crate::domain::ports::WebhookRepository`].
pub mod pg_webhook_repo;

pub use aes_secret_encryptor::AesSecretEncryptor;
pub use dns_endpoint_validator::DnsEndpointValidator;
pub use pg_webhook_repo::PgWebhookRepo;
