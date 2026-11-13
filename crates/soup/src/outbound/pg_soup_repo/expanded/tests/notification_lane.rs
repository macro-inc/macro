//! A noise notification never satisfies a notification-state filter, on
//! either path the dynamic query takes for one.

use super::*;
use item_filters::NotificationState::Unseen;

/// A document the fixture's viewer owns.
const DOCUMENT: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

/// A lone state literal is lifted into the `NotificationItems` join.
#[sqlx::test(
    fixtures(
        path = "../../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn noise_does_not_match_a_lifted_notification_state(db: PgPool) -> anyhow::Result<()> {
    let notification = "40000000-0000-0000-0000-000000000001";
    let viewer = sqlx::query_scalar!(r#"SELECT owner FROM "Document" WHERE id = $1"#, DOCUMENT)
        .fetch_one(&db)
        .await?;
    insert_notification(
        &db,
        notification,
        &viewer,
        "document",
        DOCUMENT,
        false,
        false,
    )
    .await?;
    sqlx::query!(
        "UPDATE user_notification SET lane = 'noise' WHERE notification_id = $1",
        uuid(notification),
    )
    .execute(&db)
    .await?;
    let filter = doc_ast(DocumentLiteral::NotificationState(Unseen));

    let ids = run_notification_filter(&db, filter.clone()).await?;
    assert!(!ids.contains(&uuid(DOCUMENT)));

    sqlx::query!(
        "UPDATE user_notification SET lane = 'signal' WHERE notification_id = $1",
        uuid(notification),
    )
    .execute(&db)
    .await?;
    let ids = run_notification_filter(&db, filter).await?;
    assert!(ids.contains(&uuid(DOCUMENT)));

    Ok(())
}

/// A state literal under OR with another predicate stays a per-row `EXISTS`.
#[sqlx::test(
    fixtures(
        path = "../../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn noise_does_not_match_a_per_row_notification_state(db: PgPool) -> anyhow::Result<()> {
    let notification = "40000000-0000-0000-0000-000000000002";
    let viewer = sqlx::query_scalar!(r#"SELECT owner FROM "Document" WHERE id = $1"#, DOCUMENT)
        .fetch_one(&db)
        .await?;
    insert_notification(
        &db,
        notification,
        &viewer,
        "document",
        DOCUMENT,
        false,
        false,
    )
    .await?;
    sqlx::query!(
        "UPDATE user_notification SET lane = 'noise' WHERE notification_id = $1",
        uuid(notification),
    )
    .execute(&db)
    .await?;
    let unseen = || Expr::val(DocumentLiteral::NotificationState(Unseen));
    let filter = EntityFilterAst {
        document_filter: Some(Arc::new(Expr::or(
            unseen(),
            Expr::and(unseen(), Expr::val(DocumentLiteral::Importance(true))),
        ))),
        ..mock_empty_ast()
    };

    let ids = run_notification_filter(&db, filter.clone()).await?;
    assert!(!ids.contains(&uuid(DOCUMENT)));

    sqlx::query!(
        "UPDATE user_notification SET lane = 'signal' WHERE notification_id = $1",
        uuid(notification),
    )
    .execute(&db)
    .await?;
    let ids = run_notification_filter(&db, filter).await?;
    assert!(ids.contains(&uuid(DOCUMENT)));

    Ok(())
}
