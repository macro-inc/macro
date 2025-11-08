//! Database layer conversion errors

use thiserror::Error;
use uuid::Uuid;

/// Errors that can occur during database model conversions
#[derive(Debug, Error, Clone, PartialEq)]
pub enum DbConversionError {
    #[error(
        "Invalid database state: property_option {id} has both number_value and string_value set. Expected exactly one value to be set."
    )]
    PropertyOptionBothValuesSet { id: Uuid },

    #[error(
        "Invalid database state: property_option {id} has neither number_value nor string_value set. Expected exactly one value to be set."
    )]
    PropertyOptionNoValueSet { id: Uuid },
}
