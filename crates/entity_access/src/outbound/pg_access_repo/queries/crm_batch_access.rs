//! Bounded current CRM visibility for mixed activity pages.

#[cfg(test)]
mod test;

use crate::domain::models::EntityType;
use sqlx::PgPool;
use std::collections::HashSet;
use uuid::Uuid;

/// Apply the single-record rules in batches. Pipeline grants are matched
/// against the caller's memberships as `pipeline_access` does.
#[tracing::instrument(skip_all, err)]
pub async fn visible_entities(
    pool: &PgPool,
    viewer: &str,
    entities: &[(EntityType, String)],
) -> Result<HashSet<(EntityType, String)>, sqlx::Error> {
    let mut visible = HashSet::new();
    for batch in entities.chunks(100) {
        let ids = |kind| {
            batch
                .iter()
                .filter(|(item, _)| *item == kind)
                .filter_map(|(_, id)| id.parse::<Uuid>().ok())
                .collect::<Vec<_>>()
        };
        let companies = ids(EntityType::CrmCompany);
        let contacts = ids(EntityType::CrmContact);
        if !companies.is_empty() || !contacts.is_empty() {
            let rows = sqlx::query!(
                r#"SELECT c.id AS "id!", 'crm_company' AS "kind!"
                   FROM crm_companies c JOIN team_user tu ON tu.team_id = c.team_id AND tu.user_id = $1
                   WHERE c.id = ANY($2) AND (tu.crm_access OR tu.team_role <> 'member')
                     AND (NOT c.hidden OR tu.team_role <> 'member')
                   UNION ALL
                   SELECT ct.id, 'crm_contact'
                   FROM crm_contacts ct LEFT JOIN crm_companies c ON c.id = ct.company_id
                   JOIN team_user tu ON tu.team_id = ct.team_id AND tu.user_id = $1
                   WHERE ct.id = ANY($3) AND (tu.crm_access OR tu.team_role <> 'member')
                     AND (tu.team_role <> 'member' OR (NOT ct.hidden AND c.hidden IS NOT TRUE))"#,
                viewer, &companies, &contacts,
            ).fetch_all(pool).await?;
            for row in rows {
                let kind = if row.kind == "crm_company" {
                    EntityType::CrmCompany
                } else {
                    EntityType::CrmContact
                };
                visible.insert((kind, row.id.to_string()));
            }
        }
        let pipelines = ids(EntityType::CrmPipeline);
        if !pipelines.is_empty() {
            let mut tx = Box::pin(pool.begin()).await?;
            // A requested pipeline can have many sharing grants even with 100 IDs.
            sqlx::query!("SET LOCAL statement_timeout = '15s'")
                .execute(&mut *tx)
                .await?;
            let rows = sqlx::query_scalar!(
                r#"SELECT DISTINCT ea.entity_id FROM entity_access ea
                   WHERE ea.entity_type = 'crm_pipeline' AND ea.entity_id = ANY($1)
                     AND EXISTS (SELECT FROM entity_access_source_matches(ea.source_id, $2, NULL::uuid))
                     AND NOT EXISTS (
                         SELECT FROM team_user crm_denied
                         WHERE crm_denied.user_id = $2 AND crm_denied.team_id::text = ea.source_id
                           AND (crm_denied.crm_access OR crm_denied.team_role <> 'member') IS NOT TRUE)"#,
                &pipelines, viewer,
            ).fetch_all(&mut *tx).await?;
            tx.commit().await?;
            visible.extend(
                rows.into_iter()
                    .map(|id| (EntityType::CrmPipeline, id.to_string())),
            );
        }
    }
    Ok(visible)
}
