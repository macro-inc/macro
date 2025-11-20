//! Outbound adapters - implementations of domain ports

#[cfg(feature = "postgres")]
pub mod metadata;
#[cfg(feature = "postgres")]
pub mod permission_checker;
#[cfg(feature = "postgres")]
pub mod postgres;

#[cfg(feature = "postgres")]
pub use permission_checker::PgPermissionChecker;
#[cfg(feature = "postgres")]
pub use postgres::PropertiesPgStorage;
