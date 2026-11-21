use super::*;
use crate::outbound::pg_access_repo::queries::{
    source_list_oracle,
    test_viewers::{assert_matrix_agrees, for_each_crm_setting, matrix_viewers},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use std::collections::BTreeSet;

fn sorted(entities: HashSet<(EntityType, String)>) -> BTreeSet<(String, String)> {
    entities
        .into_iter()
        .map(|(kind, id)| (kind.as_ref().to_string(), id))
        .collect()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../fixtures",
        scripts("viewer_matrix", "typed_owner_team", "viewer_matrix_pipeline")
    )
)]
async fn visible_pipelines_match_the_source_list_form(pool: PgPool) -> anyhow::Result<()> {
    let users: Vec<_> = matrix_viewers(&pool)
        .await?
        .into_iter()
        .filter(|viewer| viewer.user_id().is_some())
        .collect();
    let mut entities: Vec<_> =
        sqlx::query_scalar!(r#"SELECT id FROM crm_pipeline_entities ORDER BY id"#)
            .fetch_all(&pool)
            .await?
            .into_iter()
            .map(|id| (EntityType::CrmPipeline, id.to_string()))
            .collect();
    // Neither form shows an id without grants or one that is not a uuid.
    entities.push((EntityType::CrmPipeline, Uuid::nil().to_string()));
    entities.push((EntityType::CrmPipeline, "not-a-pipeline".to_string()));

    for_each_crm_setting(&pool, async || {
        assert_matrix_agrees(&users, &["every pipeline at once"], async |viewer, _| {
            let user_id = viewer
                .user_id()
                .ok_or_else(|| anyhow::anyhow!("{} is not a user", viewer.label))?;
            Ok((
                sorted(
                    source_list_oracle::visible_crm_entities(&pool, user_id.as_ref(), &entities)
                        .await?,
                ),
                sorted(visible_entities(&pool, user_id.as_ref(), &entities).await?),
            ))
        })
        .await
    })
    .await
}
