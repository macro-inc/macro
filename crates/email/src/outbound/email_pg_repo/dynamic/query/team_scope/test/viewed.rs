use super::*;

#[sqlx::test(
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../../../fixtures", scripts("email_crm_team_read"))
)]
async fn viewed_refill_deadline_does_not_return_a_partial_page(
    pool: sqlx::PgPool,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO email_user_history (link_id, thread_id, updated_at)
        SELECT link_id, id, '2099-01-01'::timestamptz FROM email_threads
        WHERE provider_id = 'ph:blocked-draft'
        "#,
    )
    .execute(&pool)
    .await?;
    let view = all_mail();
    let filter = any_direction("dense.test");
    let params = QueryParams {
        link_ids: vec![gamma_link(0)],
        query_limit: 3,
        user_id: GAMMA_CALLER.to_owned(),
        team_id: Some(Uuid::parse_str(GAMMA)?),
        ..params(SimpleSortMethod::ViewedUpdated)
    };
    let (found, result) = EXPIRE_VIEWED_AFTER_WINDOW
        .scope(Cell::new(None), async {
            let result = super::super::super::read_team_page(
                &pool,
                &view,
                &filter,
                params,
                Some(TeamReadTuning {
                    superset_limit: -1,
                    window_per_row: 0,
                }),
                None,
            )
            .await;
            (EXPIRE_VIEWED_AFTER_WINDOW.with(Cell::get), result)
        })
        .await;
    assert_eq!(found, Some(1), "the first window found a real eligible row");
    assert!(matches!(
        result,
        Err(PreviewReadError::ReadDeadlineExceeded)
    ));
    Ok(())
}
