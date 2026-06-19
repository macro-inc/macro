#![deny(missing_docs)]

//! Read an entity's properties flattened for search indexing.

use models_properties::EntityType;
use models_properties::service::property_value::PropertyValue;
use sqlx::{Pool, Postgres};

/// An entity property flattened into the shape the search index stores. Each
/// value lands under the field matching its type; the rest stay empty/None.
/// Covers every `PropertyValue` kind except multi-string.
#[derive(Default)]
pub struct IndexedEntityProperty {
    /// The property definition id this value belongs to.
    pub definition_id: String,
    /// Every equality-filterable value as a string: select-option UUIDs,
    /// entity-reference ids, links, text, bool as "true"/"false".
    pub values: Vec<String>,
    /// Numeric value (range + sort).
    pub number_value: Option<f64>,
    /// Date value as epoch milliseconds (range + sort).
    pub date_value: Option<i64>,
}

impl IndexedEntityProperty {
    fn is_empty(&self) -> bool {
        self.values.is_empty() && self.number_value.is_none() && self.date_value.is_none()
    }
}

struct PropertyRow {
    property_definition_id: uuid::Uuid,
    values: Option<serde_json::Value>,
}

/// Fetch an entity's properties flattened for indexing. Only select-option
/// and entity-reference values are returned (the value kinds search can
/// filter on); other value types and null values are skipped.
#[tracing::instrument(skip(pool), err)]
pub async fn get_entity_properties_for_index(
    pool: &Pool<Postgres>,
    entity_id: &str,
    entity_type: EntityType,
) -> anyhow::Result<Vec<IndexedEntityProperty>> {
    let rows = sqlx::query_as!(
        PropertyRow,
        r#"
        SELECT
            property_definition_id,
            values as "values: serde_json::Value"
        FROM entity_properties
        WHERE entity_id = $1
          AND entity_type = $2
        "#,
        entity_id,
        entity_type as EntityType,
    )
    .fetch_all(pool)
    .await?;

    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let Some(value) = row.values else {
            continue;
        };
        if value.is_null() {
            continue;
        }
        let parsed = match serde_json::from_value::<PropertyValue>(value) {
            Ok(parsed) => parsed,
            Err(e) => {
                tracing::warn!(
                    error = ?e,
                    definition_id = %row.property_definition_id,
                    "skipping unparseable property value for index"
                );
                continue;
            }
        };
        let mut property = IndexedEntityProperty {
            definition_id: row.property_definition_id.to_string(),
            ..Default::default()
        };
        match parsed {
            PropertyValue::SelectOption(ids) => {
                property.values = ids.into_iter().map(|id| id.to_string()).collect();
            }
            PropertyValue::EntityRef(refs) => {
                property.values = refs.into_iter().map(|r| r.entity_id).collect();
            }
            PropertyValue::Link(urls) => property.values = urls,
            PropertyValue::Str(s) => property.values = vec![s],
            PropertyValue::Bool(b) => property.values = vec![b.to_string()],
            PropertyValue::Num(n) => property.number_value = Some(n),
            PropertyValue::Date(d) => property.date_value = Some(d.timestamp_millis()),
        }
        if property.is_empty() {
            continue;
        }
        result.push(property);
    }

    Ok(result)
}
