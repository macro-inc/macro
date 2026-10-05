/// Event-to-activity mappings for this domain.
pub mod activity;
pub mod error;
pub mod events;
pub mod metadata;
pub mod model;
pub mod ports;
pub mod service;
pub mod service_impl;
#[cfg(test)]
mod test;

/// Atomic schema composition for database-owned definitions.
pub mod database_definition_writer;

/// Atomic cell writes for database rows, and the transaction they share.
pub mod database_cell_writer;

/// Atomic option writes for database select and tag properties.
pub mod database_option_writer;
