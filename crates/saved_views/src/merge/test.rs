use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::{Uuid, uuid};

use super::retarget_crm_list_companies_in;

const OWNER: &str = "macro|owner@example.com";
const OTHER: &str = "macro|other@example.com";
const TEAM: Uuid = uuid!("11111111-1111-1111-1111-111111111111");
const OTHER_TEAM: Uuid = uuid!("22222222-2222-2222-2222-222222222222");

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

async fn insert_view(pool: &PgPool, user: &str, config: Value) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO saved_view (id, user_id, name, config, updated_at) VALUES ($1, $2, 'List', $3, NOW())")
        .bind(id)
        .bind(user)
        .bind(config)
        .execute(pool)
        .await
        .unwrap();
    id
}

async fn view(pool: &PgPool, id: Uuid) -> (Value, i64) {
    sqlx::query_as("SELECT config, revision FROM saved_view WHERE id = $1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn crm_lists_name_the_survivor_once_in_their_order(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    insert_user(&pool, OTHER).await;
    let [survivor, first, second, kept] =
        [Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7()];
    let list = |team: Uuid, ids: &[Uuid]| {
        json!({"kind": "crm-list", "teamId": team, "companyIds": ids, "name": "Prospects"})
    };

    let both = insert_view(&pool, OWNER, list(TEAM, &[kept, first, survivor, second])).await;
    let sources_only = insert_view(&pool, OWNER, list(TEAM, &[second, kept, first])).await;
    let untouched = insert_view(&pool, OWNER, list(TEAM, &[kept])).await;
    let other_team = insert_view(&pool, OWNER, list(OTHER_TEAM, &[first])).await;
    let not_a_list = insert_view(&pool, OWNER, json!({"kind": "crm", "companyIds": [first]})).await;
    let non_member = insert_view(&pool, OTHER, list(TEAM, &[first])).await;

    let mut tx = pool.begin().await.unwrap();
    let changed = retarget_crm_list_companies_in(
        &mut tx,
        TEAM,
        &[OWNER.to_owned()],
        &[first, second],
        survivor,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let mut changed_ids: Vec<Uuid> = changed.iter().map(|view| view.view_id).collect();
    changed_ids.sort();
    let mut expected = vec![both, sources_only];
    expected.sort();
    assert_eq!(changed_ids, expected);
    let previous = changed.iter().find(|view| view.view_id == both).unwrap();
    assert_eq!(previous.previous_config, list(TEAM, &[kept, first, survivor, second]));
    assert_eq!(previous.previous_revision, 1);

    assert_eq!(view(&pool, both).await, (list(TEAM, &[kept, survivor]), 2));
    assert_eq!(view(&pool, sources_only).await, (list(TEAM, &[survivor, kept]), 2));
    for id in [untouched, other_team, not_a_list, non_member] {
        assert_eq!(view(&pool, id).await.1, 1, "view {id} must not change");
    }
}
