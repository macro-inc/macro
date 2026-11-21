use super::*;
use crate::outbound::pg_access_repo::queries::{
    source_list_oracle::{self, SourceIds},
    test_viewers::{MatrixViewer, assert_matrix_agrees, for_each_crm_setting, matrix_viewers},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

/// The source list main's pipeline reads took: a user's CRM-aware
/// `pipeline_user_sources`. Bots never reach a pipeline read, so they keep
/// their team-scope list and check the statements' bot arm.
async fn pipeline_sources(pool: &PgPool, viewer: &MatrixViewer) -> anyhow::Result<SourceIds> {
    Ok(match viewer.user_id() {
        Some(user_id) => {
            source_list_oracle::pipeline_user_sources(pool, Some(user_id.as_ref())).await?
        }
        None => viewer.sources.clone(),
    })
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../fixtures",
        scripts("viewer_matrix", "typed_owner_team", "viewer_matrix_pipeline")
    )
)]
async fn pipeline_access_matches_the_source_list_form(pool: PgPool) -> anyhow::Result<()> {
    let viewers = matrix_viewers(&pool).await?;
    let pipelines = sqlx::query_scalar!(r#"SELECT id FROM crm_pipeline_entities ORDER BY id"#)
        .fetch_all(&pool)
        .await?;
    // Pipelines are listed for signed-in users only.
    let users: Vec<_> = viewers
        .iter()
        .filter(|viewer| viewer.user_id().is_some())
        .cloned()
        .collect();

    for_each_crm_setting(&pool, async || {
        assert_matrix_agrees(&viewers, &pipelines, async |viewer, pipeline_id| {
            let sources = pipeline_sources(&pool, viewer).await?;
            Ok((
                source_list_oracle::get_pipeline_access(&pool, *pipeline_id, &sources).await?,
                get_pipeline_access(&pool, *pipeline_id, viewer.viewer()).await?,
            ))
        })
        .await?;
        assert_matrix_agrees(&users, &["every pipeline"], async |viewer, _| {
            let user_id = viewer
                .user_id()
                .ok_or_else(|| anyhow::anyhow!("{} is not a user", viewer.label))?;
            let sources = pipeline_sources(&pool, viewer).await?;
            Ok((
                source_list_oracle::list_pipeline_access(&pool, &sources).await?,
                list_pipeline_access(&pool, &user_id).await?,
            ))
        })
        .await
    })
    .await
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../fixtures",
        scripts("viewer_matrix", "typed_owner_team", "viewer_matrix_pipeline")
    )
)]
async fn pipelines_access_matches_the_source_list_form(pool: PgPool) -> anyhow::Result<()> {
    let viewers = matrix_viewers(&pool).await?;
    let mut pipelines = sqlx::query_scalar!(r#"SELECT id FROM crm_pipeline_entities ORDER BY id"#)
        .fetch_all(&pool)
        .await?;
    // An id without a pipeline or grants is left out by both forms.
    pipelines.push(Uuid::nil());

    for_each_crm_setting(&pool, async || {
        assert_matrix_agrees(&viewers, &["every pipeline at once"], async |viewer, _| {
            let sources = pipeline_sources(&pool, viewer).await?;
            let old = source_list_oracle::get_pipelines_access(&pool, &pipelines, &sources).await?;
            let new = get_pipelines_access(&pool, &pipelines, viewer.viewer()).await?;
            Ok((
                old.into_iter().collect::<BTreeMap<_, _>>(),
                new.into_iter().collect::<BTreeMap<_, _>>(),
            ))
        })
        .await
    })
    .await
}
