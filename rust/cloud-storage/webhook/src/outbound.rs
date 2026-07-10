//! Outbound adapters.

pub mod http_delivery;
pub mod http_validator;
pub mod pg_delivery_repository;
pub mod pg_repository;

pub use http_delivery::ReqwestWebhookDeliveryClient;
pub use http_validator::ReqwestWebhookValidationClient;
pub use pg_delivery_repository::PgWebhookDeliveryRepository;
pub use pg_repository::PgRepository;
