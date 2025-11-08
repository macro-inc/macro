//! Database layer property option model.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db::error::DbConversionError;

/// A selectable option for select-type properties (database representation).
///
/// The database stores number and string values in separate columns,
/// which are converted to the service layer's PropertyOptionValue enum.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropertyOption {
    pub id: Uuid,
    pub property_definition_id: Uuid,
    pub display_order: i32,
    pub number_value: Option<f64>,
    pub string_value: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl<'r> sqlx::FromRow<'r, sqlx::postgres::PgRow> for PropertyOption {
    fn from_row(row: &'r sqlx::postgres::PgRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;

        Ok(PropertyOption {
            id: row.try_get("id")?,
            property_definition_id: row.try_get("property_definition_id")?,
            display_order: row.try_get("display_order")?,
            number_value: row.try_get("number_value")?,
            string_value: row.try_get("string_value")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }
}

// ===== Conversions =====

impl std::convert::TryFrom<PropertyOption> for crate::service::property_option::PropertyOption {
    type Error = DbConversionError;

    fn try_from(db: PropertyOption) -> Result<Self, Self::Error> {
        let value = match (&db.number_value, &db.string_value) {
            (Some(n), None) => crate::service::property_option::PropertyOptionValue::Number(*n),
            (None, Some(s)) => {
                crate::service::property_option::PropertyOptionValue::String(s.clone())
            }
            (Some(_), Some(_)) => {
                return Err(DbConversionError::PropertyOptionBothValuesSet { id: db.id });
            }
            (None, None) => {
                return Err(DbConversionError::PropertyOptionNoValueSet { id: db.id });
            }
        };

        Ok(Self {
            id: db.id,
            property_definition_id: db.property_definition_id,
            display_order: db.display_order,
            value,
            created_at: db.created_at,
            updated_at: db.updated_at,
        })
    }
}
