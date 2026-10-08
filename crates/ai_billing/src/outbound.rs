//! Outbound adapters: Postgres, Stripe, the roles + teams entitlement resolver,
//! the internal settlement trigger and subscription-period reader, and the
//! settling usage recorder.

pub mod entitlement;
pub mod http_payment_gateway;
pub mod http_settlement_trigger;
pub mod pg_billing_repo;
pub mod pg_funding_repo;
pub mod pg_usage_reader;
pub mod settling_recorder;
pub mod stripe_gateway;

pub use entitlement::RolesTeamsEntitlementSource;
pub use http_payment_gateway::HttpPaymentGateway;
pub use http_settlement_trigger::HttpSettlementTrigger;
pub use pg_billing_repo::PgBillingRepo;
pub use pg_funding_repo::PgFundingRepo;
pub use pg_usage_reader::PgUsageReader;
pub use settling_recorder::SettlingUsageRecorder;
pub use stripe_gateway::{NoOpPaymentGateway, StripePaymentGateway};
