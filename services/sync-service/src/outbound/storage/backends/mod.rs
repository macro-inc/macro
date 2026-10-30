pub mod durable_kv;
#[cfg(feature = "do-sqlite-snapshot-storage")]
pub mod durable_sql;

pub mod kv;
#[cfg(feature = "kv-snapshot-storage")]
pub use kv::Kv as Storage;

#[cfg(feature = "r2-snapshot-storage")]
pub mod r2;
#[cfg(feature = "r2-snapshot-storage")]
pub use r2::R2Storage as Storage;

pub mod combined_sql_kv;
#[cfg(feature = "do-sqlite-snapshot-storage")]
pub use combined_sql_kv::Storage;
