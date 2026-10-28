//! Provider-independent encrypted persistence implementations.

/// AWS KMS envelope encryption for arbitrarily sized OAuth payloads.
pub mod cipher;
/// PostgreSQL owner transaction locking and encrypted state persistence.
pub mod postgres;
