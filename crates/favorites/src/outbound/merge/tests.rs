use macro_db_migrator::MACRO_DB_MIGRATIONS;
use model_entity::EntityType;
use sqlx::PgPool;
use uuid::Uuid;

use super::retarget_favorites_in;

const USER_A: &str = "macro|user-a@macro.com";
const USER_B: &str = "macro|user-b@macro.com";

async fn insert_user(pool: &PgPool, id: &str) {
    let macro_user_id = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
    )
    .bind(macro_user_id)
    .bind(id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#)
        .bind(id)
        .bind(macro_user_id)
        .execute(pool)
        .await
        .unwrap();
}

async fn favorite(pool: &PgPool, user: &str, entity_type: &str, entity_id: &str, sort_order: f64) {
    sqlx::query(
        "INSERT INTO favorite (user_id, entity_type, entity_id, sort_order) VALUES ($1, $2, $3, $4)",
    )
    .bind(user)
    .bind(entity_type)
    .bind(entity_id)
    .bind(sort_order)
    .execute(pool)
    .await
    .unwrap();
}

async fn favorites(pool: &PgPool) -> Vec<(String, String, String, f64)> {
    sqlx::query_as(
        "SELECT user_id, entity_type, entity_id, sort_order FROM favorite ORDER BY user_id, entity_type, entity_id",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn favorites_of_merged_records_follow_the_survivor_once_per_user(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let survivor = Uuid::now_v7().to_string();
    let [first, second] = [Uuid::now_v7().to_string(), Uuid::now_v7().to_string()];
    // A favorited the survivor and a source; B favorited both sources.
    favorite(&pool, USER_A, "crm_company", &survivor, 1.0).await;
    favorite(&pool, USER_A, "crm_company", &first, 2.0).await;
    favorite(&pool, USER_B, "crm_company", &second, 3.0).await;
    favorite(&pool, USER_B, "crm_company", &first, 5.0).await;
    // A document that happens to share the id is not a company.
    favorite(&pool, USER_B, "document", &first, 9.0).await;

    let mut tx = pool.begin().await.unwrap();
    let moved = retarget_favorites_in(
        &mut tx,
        EntityType::CrmCompany,
        &[first.clone(), second.clone()],
        &survivor,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    assert_eq!(moved.len(), 3);
    assert!(moved.iter().all(|favorite| favorite.entity_id != survivor));
    assert_eq!(
        favorites(&pool).await,
        vec![
            (USER_A.into(), "crm_company".into(), survivor.clone(), 1.0),
            (USER_B.into(), "crm_company".into(), survivor.clone(), 3.0),
            (USER_B.into(), "document".into(), first.clone(), 9.0),
        ]
    );
}
