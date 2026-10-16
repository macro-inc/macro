//! Property edges for CRM associated-item queries.

use models_properties::EntityType;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::CrmPropertyEdge;

#[cfg(test)]
mod test;

/// Entities whose Companies property names a company in `company_ids`, or
/// whose Contacts property names a contact in `contact_ids`.
///
/// The property definition ids are literals rather than binds so the planner
/// can match the partial `idx_ep_companies_value_gin` and
/// `idx_ep_contacts_value_gin` indexes; `test` pins them to
/// `SystemPropertyKey`.
pub(super) async fn property_edges(
    pool: &PgPool,
    company_ids: &[Uuid],
    contact_ids: &[Uuid],
) -> Result<Vec<CrmPropertyEdge>, sqlx::Error> {
    if company_ids.is_empty() && contact_ids.is_empty() {
        return Ok(Vec::new());
    }
    let company_ids: Vec<String> = company_ids.iter().map(Uuid::to_string).collect();
    let contact_ids: Vec<String> = contact_ids.iter().map(Uuid::to_string).collect();
    let rows = sqlx::query!(
        r#"
        SELECT ep.entity_type AS "entity_type!: EntityType", ep.entity_id AS "entity_id!"
        FROM UNNEST($1::text[]) AS company(id)
        JOIN entity_properties ep
            ON ep.property_definition_id = '00000001-0000-0000-0000-00000000000c'
           AND ep.values->'value' @> jsonb_build_array(jsonb_build_object('entity_id', company.id))
        UNION
        SELECT ep.entity_type, ep.entity_id
        FROM UNNEST($2::text[]) AS contact(id)
        JOIN entity_properties ep
            ON ep.property_definition_id = '00000001-0000-0000-0000-000000000013'
           AND ep.values->'value' @> jsonb_build_array(jsonb_build_object('entity_id', contact.id))
        "#,
        &company_ids,
        &contact_ids,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| CrmPropertyEdge {
            entity_type: row.entity_type,
            entity_id: row.entity_id,
        })
        .collect())
}
