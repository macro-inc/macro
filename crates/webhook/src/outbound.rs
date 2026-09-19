//! Outbound adapters.

#[cfg(feature = "outbound")]
pub mod http_delivery;
#[cfg(feature = "outbound")]
pub mod http_validator;
#[cfg(feature = "outbound")]
pub mod pg_delivery_repository;
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
pub use pg_repository::PgRepository;
#[cfg(feature = "outbound")]
pub use sqs_queue::SqsWebhookQueue;
