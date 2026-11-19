use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

async fn account(db: &PgPool, email: &str) -> String {
    let id = macro_uuid::generate_uuid_v7();
    let macro_id = format!("macro|{email}");
    sqlx::query!(
        "INSERT INTO macro_user (id,username,email,stripe_customer_id) VALUES ($1,$2,$3,$4)",
        id,
        macro_id,
        email,
        format!("cus_{id}")
    )
    .execute(db)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id,email,macro_user_id) VALUES ($1,$2,$3)"#,
        macro_id,
        email,
        id
    )
    .execute(db)
    .await
    .unwrap();
    macro_id
}

/// A Gmail inbox `team@example.com` that `owner` added.
async fn held_inbox(db: &PgPool, owner: &str) -> Link {
    sqlx::query!(
        "INSERT INTO email_links(id,macro_id,fusionauth_user_id,email_address,provider) VALUES ($1,$2,'holder-credentials','team@example.com','GMAIL')",
        macro_uuid::generate_uuid_v7(),
        owner
    )
    .execute(db)
    .await
    .unwrap();
    email_db_client::links::get::fetch_link_by_email(
        db,
        "team@example.com",
        models_email::service::link::UserProvider::Gmail,
    )
    .await
    .unwrap()
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn link_status_reports_a_removal_and_a_deleted_owner(db: PgPool) {
    let owner = account(&db, "owner@example.com").await;
    let inbox = held_inbox(&db, &owner).await;
    let links = PgConnectionLinks {
        db: db.clone(),
        lookup: email::outbound::EmailPgRepo::new(db.clone()),
    };
    let status = |link| {
        let links = &links;
        async move {
            let status = links.link_status(link).await.unwrap();
            (status.owner_account_exists, status.being_removed)
        }
    };
    assert_eq!(status(inbox.id).await, (true, false));

    // Account deletion removes the profile at once and the inbox later.
    sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, owner)
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(status(inbox.id).await, (false, false));

    sqlx::query!(
        "UPDATE email_links SET disconnect_requested_at = now() WHERE id = $1",
        inbox.id
    )
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(status(inbox.id).await, (false, true));
    assert_eq!(
        status(Uuid::now_v7()).await,
        (false, true),
        "a purged link was being removed"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn promoting_an_inbox_whose_owner_account_is_gone_writes_nothing(db: PgPool) {
    let owner = account(&db, "owner@example.com").await;
    let actor = account(&db, "actor@example.com").await;
    let inbox = held_inbox(&db, &owner).await;
    sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, owner)
        .execute(&db)
        .await
        .unwrap();

    let promoted = PgConnectionTransactions(db.clone())
        .promote(&actor, "team@example.com", &inbox)
        .await
        .unwrap();

    assert!(promoted.is_none());
    assert_eq!(
        sqlx::query_scalar!("SELECT macro_id FROM email_links WHERE id = $1", inbox.id)
            .fetch_one(&db)
            .await
            .unwrap(),
        owner
    );
    assert_eq!(
        sqlx::query_scalar!(r#"SELECT count(*) FROM "User" WHERE id = 'macro|team@example.com'"#)
            .fetch_one(&db)
            .await
            .unwrap(),
        Some(0)
    );
}
