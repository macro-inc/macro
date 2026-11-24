use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_uuid::Uuid;

use super::*;
use crate::domain::model::SessionKind;
use crate::outbound::pg_suggestion_repo::test::insert_user;

const OWNER: &str = "macro|suggestions-topics@macro.com";

fn session() -> GenerationSession {
    GenerationSession {
        session: Uuid::now_v7(),
        generation: Uuid::now_v7(),
        user: MacroUserIdStr::parse_from_str(OWNER).unwrap(),
        kind: SessionKind::Suggestions,
        surfaces: Vec::new(),
        trace_id: None,
    }
}

fn topic(key: &str) -> NameTopic {
    NameTopic {
        key: key.to_owned(),
        name: "Spring offsite".to_owned(),
        reason: None,
    }
}

async fn suggestion_in(pool: &PgPool, key: &str, state: &str, changed_at: DateTime<Utc>) {
    sqlx::query!(
        r#"INSERT INTO suggestion (id, user_id, kind, dedup_key, title, summary, importance,
                             categories, state, session_id, created_at, updated_at,
                             state_changed_at, topic_key, state_reason)
           VALUES ($1, $2, 'entity', $3, 'Title', 'Summary', 50, '{}', $4, $5, now(), now(),
                   $6, $7, CASE WHEN $4 = 'resolved' THEN 'deleted' END)"#,
        Uuid::now_v7(),
        OWNER,
        Uuid::now_v7().to_string(),
        state,
        Uuid::now_v7(),
        changed_at,
        key,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// Sessions of one generation naming topics at once stay within its limit
/// together.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_names_stay_within_the_limit(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let session = session();
    let names = (0..6).map(|n| {
        let (pool, session) = (&pool, &session);
        async move {
            name_topic(pool, session, &topic(&format!("topic:{n}")), 3, Utc::now())
                .await
                .unwrap()
        }
    });
    let named = futures::future::join_all(names).await;
    assert_eq!(named.iter().filter(|named| **named).count(), 3);
}

/// Only a suggestion done or resolved settles its topic, the latest one.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_topic_settles_when_one_of_its_suggestions_is_done_or_resolved(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let session = session();
    for key in ["quiet", "settled"] {
        name_topic(&pool, &session, &topic(key), 15, Utc::now())
            .await
            .unwrap();
    }
    let at = |hours: i64| DateTime::from_timestamp(1_790_000_000 + hours * 3600, 0).unwrap();
    for state in ["proposed", "accepted", "dismissed", "retired"] {
        suggestion_in(&pool, "quiet", state, at(9)).await;
        suggestion_in(&pool, "settled", state, at(9)).await;
    }
    suggestion_in(&pool, "settled", "done", at(1)).await;
    suggestion_in(&pool, "settled", "resolved", at(2)).await;
    let keys = ["quiet", "settled", "unknown"].map(str::to_owned);
    let mut found = topics(&pool, &session.user, &keys).await.unwrap();
    found.sort_by(|a, b| a.key.cmp(&b.key));
    let settled: Vec<_> = found
        .iter()
        .map(|topic| (topic.key.as_str(), topic.settled_at))
        .collect();
    assert_eq!(settled, [("quiet", None), ("settled", Some(at(2)))]);
}

/// Deleting a person deletes their topics with their suggestions, though the
/// suggestions name the topics.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_person_deletes_their_topics(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    name_topic(&pool, &session(), &topic("offsite"), 15, Utc::now())
        .await
        .unwrap();
    suggestion_in(&pool, "offsite", "proposed", Utc::now()).await;
    sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, OWNER)
        .execute(&pool)
        .await
        .unwrap();
    let left = sqlx::query_scalar!(r#"SELECT count(*) AS "n!" FROM suggestion_topic"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(left, 0);
}
