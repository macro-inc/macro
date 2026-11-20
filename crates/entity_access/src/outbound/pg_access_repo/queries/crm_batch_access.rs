//! Bounded current CRM visibility for mixed activity pages.

use super::pipeline_access;
use crate::domain::models::EntityType;
use sqlx::PgPool;
use std::collections::HashSet;
use uuid::Uuid;

/// Apply the single-record rules in batches, resolving pipeline sources once.
#[tracing::instrument(skip_all, err)]
pub async fn visible_entities(
    pool: &PgPool,
    viewer: &str,
    entities: &[(EntityType, String)],
) -> Result<HashSet<(EntityType, String)>, sqlx::Error> {
    let sources = if entities
        .iter()
        .any(|(kind, _)| *kind == EntityType::CrmPipeline)
    {
        Some(pipeline_access::user_sources(pool, Some(viewer)).await?)
    } else {
        None
    };
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
        if let Some(sources) = &sources
            && !pipelines.is_empty()
        {
            let mut tx = Box::pin(pool.begin()).await?;
            // A requested pipeline can have many sharing grants even with 100 IDs.
            sqlx::query!("SET LOCAL statement_timeout = '15s'")
                .execute(&mut *tx)
                .await?;
            let rows = sqlx::query_scalar!(
                "SELECT DISTINCT entity_id FROM entity_access WHERE entity_type = 'crm_pipeline' AND entity_id = ANY($1) AND source_id = ANY($2)",
                &pipelines, &sources.0,
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
