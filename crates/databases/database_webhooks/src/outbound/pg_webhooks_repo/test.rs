use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;

const ALICE: &str = "macro|alice@webhooks-repo.test";

async fn insert_user(pool: &PgPool, user_id: &str) {
    let email = user_id.trim_start_matches("macro|");
    let macro_user_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)"#,
        macro_user_id,
        email,
        format!("cus_{macro_user_id}"),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        user_id,
        email,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// A database entity owned by Alice, with one table.
async fn insert_database(pool: &PgPool) -> (DatabaseId, TableId) {
    let database = Uuid::now_v7();
    sqlx::query!(
        r#"WITH storage AS (INSERT INTO databases (id) VALUES ($1) RETURNING id)
           INSERT INTO database_entities (database_id, name, user_id) SELECT id, 'Meetings', $2 FROM storage"#,
        database,
        ALICE,
    )
    .execute(pool)
    .await
    .unwrap();
    let table = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO database_tables (id, database_id, name, position) VALUES ($1, $2, 'Meetings', 'a0')"#,
        table,
        database,
    )
    .execute(pool)
    .await
    .unwrap();
    (DatabaseId::from_uuid(database), TableId::from_uuid(table))
}

fn new_webhook(database_id: DatabaseId, table_id: TableId, token: &str) -> NewWebhook {
    NewWebhook {
        id: Uuid::now_v7(),
        database_id,
        table_id,
        created_by: ALICE.to_string(),
        token_hash: crate::domain::token::hash(token),
        token_prefix: crate::domain::token::prefix(token),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_webhook_is_found_by_its_token_hash_and_listed_with_its_database(pool: PgPool) {
    insert_user(&pool, ALICE).await;
    let (database, table) = insert_database(&pool).await;
    let (other_database, other_table) = insert_database(&pool).await;
    let repository = PgWebhooksRepo::new(pool);
    let token = "mdbw_0123456789ab_secret";
    let new = new_webhook(database, table, token);

    let stored = repository.insert_webhook(new.clone()).await.unwrap();
    repository
        .insert_webhook(new_webhook(other_database, other_table, "mdbw_other"))
        .await
        .unwrap();

    assert_eq!(
        stored,
        DatabaseWebhook {
            id: new.id,
            database_id: database,
            table_id: table,
            created_by: ALICE.to_string(),
            token_prefix: "mdbw_0123456789ab".to_string(),
            created_at: stored.created_at,
        }
    );
    assert_eq!(
        repository
            .webhook_by_token_hash(crate::domain::token::hash(token))
            .await
            .unwrap(),
        Some(stored.clone())
    );
    assert_eq!(
        repository
            .webhook_by_token_hash(crate::domain::token::hash("mdbw_unknown"))
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        repository.database_webhooks(database).await.unwrap(),
        vec![stored]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_webhook_is_deleted_only_through_its_own_database(pool: PgPool) {
    insert_user(&pool, ALICE).await;
    let (database, table) = insert_database(&pool).await;
    let (other_database, _) = insert_database(&pool).await;
    let repository = PgWebhooksRepo::new(pool);
    let webhook = repository
        .insert_webhook(new_webhook(database, table, "mdbw_delete"))
        .await
        .unwrap();

    assert!(
        !repository
            .delete_webhook(other_database, webhook.id)
            .await
            .unwrap()
    );
    assert!(
        repository
            .delete_webhook(database, webhook.id)
            .await
            .unwrap()
    );
    assert!(
        repository
            .database_webhooks(database)
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_webhook_goes_with_its_table(pool: PgPool) {
    insert_user(&pool, ALICE).await;
    let (database, table) = insert_database(&pool).await;
    let repository = PgWebhooksRepo::new(pool.clone());
    repository
        .insert_webhook(new_webhook(database, table, "mdbw_table"))
        .await
        .unwrap();

    sqlx::query!("DELETE FROM database_tables WHERE id = $1", table.as_uuid())
        .execute(&pool)
        .await
        .unwrap();

    assert!(
        repository
            .database_webhooks(database)
            .await
            .unwrap()
            .is_empty()
    );
}
