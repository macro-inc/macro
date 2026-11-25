use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

use super::{MergedParent, merge_discussions_in};

const USER: &str = "macro|merge-test@example.com";

async fn setup(pool: &PgPool) -> Uuid {
    let macro_user = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id)
           VALUES ($1, 'merge-test', 'merge-test@example.com', 'merge-test')"#,
        macro_user
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, 'merge-test@example.com', $2)"#,
        USER,
        macro_user
    )
    .execute(pool)
    .await
    .unwrap();
    let team = Uuid::now_v7();
    sqlx::query!("INSERT INTO team (id, name, owner_id) VALUES ($1, 'test', $2)", team, USER)
        .execute(pool)
        .await
        .unwrap();
    team
}

async fn company(pool: &PgPool, team: Uuid) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO crm_companies (id, team_id, first_interaction, last_interaction) VALUES ($1, $2, now(), now())",
        id,
        team
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn message(pool: &PgPool, parent: Uuid, thread: Option<Uuid>) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO comms_messages (id, parent_entity_type, parent_entity_id, thread_id, sender_id, content)
         VALUES ($1, 'crm_company', $2, $3, $4, 'hello')",
        id,
        parent.to_string(),
        thread,
        USER
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn mention(pool: &PgPool, entity_type: &str, entity_id: Uuid) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO comms_entity_mentions (id, entity_type, entity_id, source_entity_type, source_entity_id)
         VALUES ($1, $2, $3, 'document', 'doc')",
        id,
        entity_type,
        entity_id.to_string()
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn discussions_and_mentions_move_to_the_survivor_with_their_ids(pool: PgPool) {
    let team = setup(&pool).await;
    let [survivor, source, other] = [
        company(&pool, team).await,
        company(&pool, team).await,
        company(&pool, team).await,
    ];
    let root = message(&pool, source, None).await;
    let reply = message(&pool, source, Some(root)).await;
    let survivor_root = message(&pool, survivor, None).await;
    let other_root = message(&pool, other, None).await;
    let source_mention = mention(&pool, "crm_company", source).await;
    let contact_mention = mention(&pool, "crm_contact", source).await;

    let mut tx = pool.begin().await.unwrap();
    let merged = merge_discussions_in(&mut tx, MergedParent::CrmCompany, &[source], survivor)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let mut messages = merged.messages.clone();
    messages.sort();
    let mut expected = vec![(root, source.to_string()), (reply, source.to_string())];
    expected.sort();
    assert_eq!(messages, expected);
    assert_eq!(merged.threads, vec![(root, source.to_string())]);
    assert_eq!(merged.mentions, vec![(source_mention, source.to_string())]);

    let parents: Vec<(Uuid, Option<Uuid>, Option<Uuid>)> = sqlx::query_as(
        "SELECT id, thread_id, crm_company_message_parent_id FROM comms_messages ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    for (id, thread, parent) in parents {
        let expected = if id == other_root { other } else { survivor };
        assert_eq!(parent, Some(expected), "message {id}");
        if id == reply {
            assert_eq!(thread, Some(root), "the reply keeps its thread");
        }
    }
    let thread_parent: String = sqlx::query_scalar(
        "SELECT parent_entity_id FROM comms_message_threads WHERE root_id = $1",
    )
    .bind(root)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(thread_parent, survivor.to_string());
    let _ = survivor_root;

    let contact_target: String =
        sqlx::query_scalar("SELECT entity_id FROM comms_entity_mentions WHERE id = $1")
            .bind(contact_mention)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(contact_target, source.to_string(), "contact mentions are not companies");

    // The source can now go without taking its discussion with it.
    sqlx::query!("DELETE FROM crm_companies WHERE id = $1", source)
        .execute(&pool)
        .await
        .unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM comms_messages")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 4);
}
