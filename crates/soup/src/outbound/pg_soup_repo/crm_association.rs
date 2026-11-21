//! Property edges for CRM associated-item queries.

use models_properties::EntityType;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::CrmPropertyEdge;

#[cfg(test)]
mod test;

/// Entities whose Companies or Contacts properties name the requested CRM records,
/// including typed references in entity columns currently bound to database rows.
/// With `custom_task_properties`, also the tasks whose own custom
/// entity-reference properties name them, whoever owns the property: a task
/// shows every property set on it to everyone who can open it.
///
/// Every arm starts from the requested ids and reaches matching properties
/// through a partial GIN index, so the cost follows the records asked about
/// rather than the size of `entity_properties`:
///
/// - Companies and Contacts properties: `idx_ep_companies_value_gin` and
///   `idx_ep_contacts_value_gin`. The property definition ids are literals
///   rather than binds so the planner can match those indexes' predicates;
///   `test` pins them to `SystemPropertyKey`.
/// - Database row cells: `idx_ep_database_row_references_gin`, which holds
///   only database row cells whose value is an entity reference; no other cell
///   can name a record. A matched cell counts when its definition is an entity
///   definition placed as a column of its row's table, checked by key for each
///   matched cell.
/// - Custom task properties: `idx_ep_crm_record_references_gin`, which holds
///   the values that reference a company or contact outside the Companies and
///   Contacts properties and database rows. The arm repeats that index's
///   predicate, which is what lets the planner use it. A matched value counts
///   when its definition is a custom entity definition, one a team or a person
///   owns.
#[tracing::instrument(
    name = "soup.crm_property_edges",
    skip_all,
    fields(
        companies = company_ids.len(),
        contacts = contact_ids.len(),
        custom_task_properties,
        edges = tracing::field::Empty,
    ),
    err
)]
pub(super) async fn property_edges(
    pool: &PgPool,
    company_ids: &[Uuid],
    contact_ids: &[Uuid],
    custom_task_properties: bool,
) -> Result<Vec<CrmPropertyEdge>, sqlx::Error> {
    if company_ids.is_empty() && contact_ids.is_empty() {
        return Ok(Vec::new());
    }
    let company_ids: Vec<String> = company_ids.iter().map(Uuid::to_string).collect();
    let contact_ids: Vec<String> = contact_ids.iter().map(Uuid::to_string).collect();
    // Activity asks for every visible record of the caller's teams, so the
    // cost follows the team's record count: bound it like the association
    // read that produced the ids.
    let mut transaction = pool.begin().await?;
    sqlx::query!("SET LOCAL statement_timeout = '15s'")
        .execute(&mut *transaction)
        .await?;
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
        UNION
        SELECT cell.entity_type, cell.entity_id
        FROM (
            SELECT jsonb_build_array(jsonb_build_object('entity_type', 'COMPANY', 'entity_id', id))
            FROM UNNEST($1::text[]) AS company(id)
            UNION ALL
            SELECT jsonb_build_array(jsonb_build_object('entity_type', 'CONTACT', 'entity_id', id))
            FROM UNNEST($2::text[]) AS contact(id)
        ) AS record(reference)
        -- Fenced so each record probes the index. Joined plainly, the planner
        -- can start from every entity definition and compare all of their
        -- cells with every record. It did so from about 500 records with
        -- fresh statistics, and for a single record once they were stale.
        CROSS JOIN LATERAL (
            SELECT ep.entity_type, ep.entity_id, ep.property_definition_id
            FROM entity_properties ep
            WHERE ep.entity_type = 'DATABASE_ROW'
              AND ep.values->>'type' = 'EntityReference'
              AND ep.values->'value' @> record.reference
            OFFSET 0
        ) AS cell
        -- Fenced too: three lookups by key per matched cell, never a join
        -- over every definition, row, or column.
        WHERE EXISTS (
            SELECT 1
            FROM property_definitions pd
            -- A row cell's entity id is its row id's canonical text; anything else
            -- names no row, and must not abort the statement with a cast error.
            JOIN database_rows r
                ON r.id = (CASE
                    WHEN cell.entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    THEN cell.entity_id
                END)::uuid
            JOIN database_columns dc
                ON dc.table_id = r.table_id AND dc.property_definition_id = pd.id
            WHERE pd.id = cell.property_definition_id AND pd.data_type = 'ENTITY'
            OFFSET 0
        )
        UNION
        SELECT task.entity_type, task.entity_id
        FROM (
            SELECT jsonb_build_array(jsonb_build_object('entity_type', 'COMPANY', 'entity_id', id))
            FROM UNNEST($1::text[]) AS company(id)
            UNION ALL
            SELECT jsonb_build_array(jsonb_build_object('entity_type', 'CONTACT', 'entity_id', id))
            FROM UNNEST($2::text[]) AS contact(id)
        ) AS record(reference)
        -- Fenced so each record probes the index. Joined plainly, the planner
        -- can start from every custom entity definition and read all of their
        -- values, which it prefers once statistics are stale or the records
        -- are many.
        CROSS JOIN LATERAL (
            SELECT ep.entity_type, ep.entity_id, ep.property_definition_id
            FROM entity_properties ep
            WHERE ep.entity_type = 'TASK'
              AND ep.property_definition_id <> '00000001-0000-0000-0000-00000000000c'
              AND ep.property_definition_id <> '00000001-0000-0000-0000-000000000013'
              AND (ep.values->'value' @> '[{"entity_type": "COMPANY"}]'
                   OR ep.values->'value' @> '[{"entity_type": "CONTACT"}]')
              AND ep.values->'value' @> record.reference
            OFFSET 0
        ) AS task
        WHERE $3
          -- Fenced too: one lookup by key per matched value, never a read of
          -- every custom definition.
          AND EXISTS (
              SELECT 1
              FROM property_definitions pd
              WHERE pd.id = task.property_definition_id
                AND pd.data_type = 'ENTITY'
                AND NOT pd.is_system
                AND pd.database_id IS NULL
              OFFSET 0
          )
        "#,
        &company_ids,
        &contact_ids,
        custom_task_properties,
    )
    .fetch_all(&mut *transaction)
    .await?;
    transaction.commit().await?;
    tracing::Span::current().record("edges", rows.len());
    Ok(rows
        .into_iter()
        .map(|row| CrmPropertyEdge {
            entity_type: row.entity_type,
            entity_id: row.entity_id,
        })
        .collect())
}
