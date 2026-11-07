//! Outbound (driven) adapters for account managers.

#[cfg(feature = "outbound")]
pub mod dm_delivery;
#[cfg(feature = "postgres")]
pub mod pg_account_manager_repo;
