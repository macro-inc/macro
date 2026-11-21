//! Outbound adapters.

#[cfg(feature = "outbound")]
mod address_guard;
#[cfg(feature = "outbound")]
pub mod http_delivery;
#[cfg(feature = "outbound")]
mod http_mcp_endpoint;
#[cfg(feature = "outbound")]
pub mod http_validator;
#[cfg(feature = "outbound")]
pub mod pg_delivery_repository;
#[cfg(feature = "outbound")]
pub mod pg_mcp_subscription_repository;
#[cfg(feature = "outbound")]
pub mod pg_repository;
#[cfg(feature = "outbound")]
pub mod sqs_queue;

#[cfg(feature = "outbound")]
pub use http_delivery::ReqwestWebhookDeliveryClient;
#[cfg(feature = "outbound")]
pub use http_validator::ReqwestWebhookValidationClient;
#[cfg(feature = "outbound")]
pub use pg_delivery_repository::PgWebhookDeliveryRepository;
#[cfg(feature = "outbound")]
pub use pg_mcp_subscription_repository::PgMcpSubscriptionRepository;
#[cfg(feature = "outbound")]
pub use pg_repository::PgRepository;
#[cfg(feature = "outbound")]
pub use sqs_queue::SqsWebhookQueue;
#[cfg(feature = "kms")]
pub mod kms_mcp_secret_cipher;
#[cfg(feature = "kms")]
pub use kms_mcp_secret_cipher::KmsMcpSecretCipher;
