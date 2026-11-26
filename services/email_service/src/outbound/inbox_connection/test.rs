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
async fn a_link_departs_when_its_removal_starts_or_its_owner_account_is_gone(db: PgPool) {
    let links = PgConnectionLinks {
        db: db.clone(),
        lookup: email::outbound::EmailPgRepo::new(db.clone()),
    };
    let owner = account(&db, "owner@example.com").await;
    let inbox = held_inbox(&db, &owner).await;
    assert!(!links.link_departing(inbox.id).await.unwrap());

    sqlx::query!(
        "UPDATE email_links SET disconnect_requested_at = now() WHERE id = $1",
        inbox.id
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(links.link_departing(inbox.id).await.unwrap());

    sqlx::query!(
        "UPDATE email_links SET disconnect_requested_at = NULL WHERE id = $1",
        inbox.id
    )
    .execute(&db)
    .await
    .unwrap();
    // Account deletion removes the profile at once and the inbox later.
    sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, owner)
        .execute(&db)
        .await
        .unwrap();
    assert!(links.link_departing(inbox.id).await.unwrap());
    assert!(
        links.link_departing(Uuid::now_v7()).await.unwrap(),
        "a purged link was departing"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn promotion_refuses_a_departing_inbox_and_writes_nothing(db: PgPool) {
    let actor = account(&db, "actor@example.com").await;
    for (removal, owner_email) in [
        ("owner deleted", "deleted@example.com"),
        ("disconnect requested", "leaving@example.com"),
    ] {
        let owner = account(&db, owner_email).await;
        let inbox = held_inbox(&db, &owner).await;
        if removal == "owner deleted" {
            sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, owner)
                .execute(&db)
                .await
                .unwrap();
        } else {
            sqlx::query!(
                "UPDATE email_links SET disconnect_requested_at = now() WHERE id = $1",
                inbox.id
            )
            .execute(&db)
            .await
            .unwrap();
        }

        let promoted = PgConnectionTransactions(db.clone())
            .promote(&actor, "team@example.com", &inbox)
            .await;

        assert!(
            matches!(
                promoted,
                Err(ConnectionError::MailboxInitialization(
                    email::domain::mailbox::initialization::InitializationError::InboxBeingRemoved
                ))
            ),
            "{removal}"
        );
        assert_eq!(
            sqlx::query_scalar!("SELECT macro_id FROM email_links WHERE id = $1", inbox.id)
                .fetch_one(&db)
                .await
                .unwrap(),
            owner,
            "{removal}"
        );
        assert_eq!(
            sqlx::query_scalar!(
                r#"SELECT count(*) FROM "User" WHERE id = 'macro|team@example.com'"#
            )
            .fetch_one(&db)
            .await
            .unwrap(),
            Some(0),
            "{removal}"
        );
        sqlx::query!("DELETE FROM email_links WHERE id = $1", inbox.id)
            .execute(&db)
            .await
            .unwrap();
    }
}

/// Holds the link the way a CRM contact population does for its whole
/// transaction.
async fn population(db: &PgPool, link: Uuid) -> sqlx::Transaction<'static, sqlx::Postgres> {
    let mut tx = db.begin().await.unwrap();
    sqlx::query!("SELECT id FROM email_links WHERE id = $1 FOR SHARE", link)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    tx
}

fn is_busy<T>(result: &Result<T, ConnectionError>) -> bool {
    matches!(
        result,
        Err(ConnectionError::MailboxInitialization(
            email::domain::mailbox::initialization::InitializationError::Contended
        ))
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_promotion_behind_a_population_is_busy_then_promotes(db: PgPool) {
    let actor = account(&db, "actor@example.com").await;
    let owner = account(&db, "owner@example.com").await;
    let inbox = held_inbox(&db, &owner).await;
    let transactions = PgConnectionTransactions(db.clone());

    let held = population(&db, inbox.id).await;
    let blocked = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        transactions.promote(&actor, "team@example.com", &inbox),
    )
    .await
    .expect("the promotion waited past its lock timeout");
    assert!(is_busy(&blocked), "{:?}", blocked.err());
    assert_eq!(
        sqlx::query_scalar!("SELECT macro_id FROM email_links WHERE id = $1", inbox.id)
            .fetch_one(&db)
            .await
            .unwrap(),
        owner
    );
    held.rollback().await.unwrap();

    transactions
        .promote(&actor, "team@example.com", &inbox)
        .await
        .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_gmail_reconnect_behind_a_population_is_busy_then_reconnects(db: PgPool) {
    let owner = account(&db, "owner@example.com").await;
    let inbox = held_inbox(&db, &owner).await;
    let transactions = PgConnectionTransactions(db.clone());
    let histories = || async {
        sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM email_gmail_histories WHERE link_id = $1"#,
            inbox.id
        )
        .fetch_one(&db)
        .await
        .unwrap()
    };

    let held = population(&db, inbox.id).await;
    let blocked = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        transactions.create(&owner, inbox.clone(), "history-1"),
    )
    .await
    .expect("the reconnect waited past its lock timeout");
    assert!(is_busy(&blocked), "{:?}", blocked.err());
    assert_eq!(histories().await, 0);
    held.rollback().await.unwrap();

    transactions
        .create(&owner, inbox.clone(), "history-1")
        .await
        .unwrap();
    assert_eq!(histories().await, 1);
}
