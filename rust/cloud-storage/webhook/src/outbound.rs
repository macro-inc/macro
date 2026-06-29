//! Outbound adapters.

pub mod http_validator;
pub mod pg_repository;

pub use http_validator::ReqwestWebhookValidationClient;
pub use pg_repository::PgRepository;
