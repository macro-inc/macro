use super::*;
use activity::{Actor, Attribution, CommonAction, EntityType};
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;

macro_env_var::maybe_env_var! {
    struct RedisUrl;
}

const TEST_IDLE: Duration = Duration::from_secs(30);

fn store() -> RedisEditingActivityStore {
    let redis_url = RedisUrl::new();
    let url = redis_url
        .as_ref()
        .and_then(RedisUrl::value)
        .unwrap_or("redis://127.0.0.1:6379");
    RedisEditingActivityStore::new(redis::Client::open(url).unwrap())
}

fn edit(document_id: &str, actor: &str, subject: Option<&str>) -> Activity {
    Activity::attributed(
        Uuid::now_v7(),
        0,
        Attribution::new(
            Actor::try_from(actor.to_owned()).unwrap(),
            subject.map(|user| MacroUserIdStr::try_from(user.to_owned()).unwrap()),
        ),
        EntityType::Document,
        document_id,
        CommonAction::Edited,
        Utc::now(),
    )
}

#[tokio::test]
async fn replay_keeps_the_original_admission_decision_after_later_edits() {
    let store = store();
    let activities = [edit(
        &Uuid::now_v7().to_string(),
        "macro|editor@example.com",
        None,
    )];
    let first = Uuid::now_v7();
    let later = Uuid::now_v7();
    for (event_id, expected) in [
        (first, true),
        (first, true),
        (later, false),
        (later, false),
        (first, true),
    ] {
        assert_eq!(
            store
                .refresh_editing_sessions(&activities, event_id, TEST_IDLE)
                .await
                .unwrap(),
            vec![expected],
        );
    }
}

#[tokio::test]
async fn actor_subject_and_document_have_independent_sessions_in_input_order() {
    let store = store();
    let document = Uuid::now_v7().to_string();
    let other_document = Uuid::now_v7().to_string();
    let agent = format!("bot|{}", Uuid::now_v7());
    let other_agent = format!("bot|{}", Uuid::now_v7());
    let alice = "macro|alice@example.com";
    let bob = "macro|bob@example.com";
    let first = edit(&document, &agent, Some(alice));
    assert_eq!(
        store
            .refresh_editing_sessions(std::slice::from_ref(&first), Uuid::now_v7(), TEST_IDLE)
            .await
            .unwrap(),
        vec![true],
    );

    let activities = [
        edit(&document, &other_agent, Some(alice)),
        first,
        edit(&document, &agent, Some(bob)),
        edit(&other_document, &agent, Some(alice)),
        edit(&document, alice, None),
    ];
    assert_eq!(
        store
            .refresh_editing_sessions(&activities, Uuid::now_v7(), TEST_IDLE)
            .await
            .unwrap(),
        vec![true, false, true, true, true],
    );
}

#[tokio::test]
async fn concurrent_distinct_events_admit_only_one_session_start() {
    let store = store();
    let activities = [edit(
        &Uuid::now_v7().to_string(),
        "macro|concurrent@example.com",
        None,
    )];
    let results = futures::future::join_all(
        (0..16).map(|_| store.refresh_editing_sessions(&activities, Uuid::now_v7(), TEST_IDLE)),
    )
    .await;
    assert_eq!(
        results
            .into_iter()
            .filter(|result| result.as_ref().unwrap()[0])
            .count(),
        1,
    );
}

#[tokio::test]
async fn suppressed_edits_extend_expiry_until_a_full_inactivity_window() {
    let store = store();
    let activities = [edit(
        &Uuid::now_v7().to_string(),
        "macro|sliding@example.com",
        None,
    )];
    let idle = Duration::from_secs(3);
    assert_eq!(
        store
            .refresh_editing_sessions(&activities, Uuid::now_v7(), idle)
            .await
            .unwrap(),
        vec![true],
    );
    tokio::time::sleep(Duration::from_millis(1500)).await;
    assert_eq!(
        store
            .refresh_editing_sessions(&activities, Uuid::now_v7(), idle)
            .await
            .unwrap(),
        vec![false],
    );
    // The original expiry has elapsed, but the suppressed edit extended it.
    tokio::time::sleep(Duration::from_millis(1800)).await;
    assert_eq!(
        store
            .refresh_editing_sessions(&activities, Uuid::now_v7(), idle)
            .await
            .unwrap(),
        vec![false],
    );
    tokio::time::sleep(idle + Duration::from_millis(200)).await;
    assert_eq!(
        store
            .refresh_editing_sessions(&activities, Uuid::now_v7(), idle)
            .await
            .unwrap(),
        vec![true],
    );
}

#[tokio::test]
async fn an_empty_batch_does_not_connect_to_redis() {
    let store = RedisEditingActivityStore::new(redis::Client::open("redis://127.0.0.1:1").unwrap());
    assert!(
        store
            .refresh_editing_sessions(&[], Uuid::now_v7(), TEST_IDLE)
            .await
            .unwrap()
            .is_empty()
    );
}
