//! The activity check: what counts as a person using Macro, and what work
//! done for them does not.

use chrono::{DateTime, Duration};

use super::teammate_feed::insert_user;
use super::*;
use crate::domain::models::{AppearanceChange, NON_TOUCH_ACTION_TAGS};
use crate::domain::ports::{SeenLog, UserActivity};

const ADA: &str = "macro|ada@example.com";
const BEA: &str = "macro|bea@example.com";

/// A week before now, as a job asking about the last seven days would.
fn week_ago() -> DateTime<Utc> {
    Utc::now() - Duration::days(7)
}

/// An activity on a document `at`, done by `actor` for `subject` when they
/// differ.
fn on_a_document(
    source: u128,
    actor: Actor<'static>,
    subject: Option<&str>,
    action: CommonAction,
    at: DateTime<Utc>,
) -> Activity {
    Activity::common(
        Uuid::from_u128(source),
        0,
        actor,
        subject.map(user),
        EntityType::Document,
        "active-document",
        action,
        at,
    )
}

fn ada_edits(source: u128, at: DateTime<Utc>) -> Activity {
    on_a_document(
        source,
        Actor::new_from_user(user(ADA)),
        None,
        CommonAction::Edited,
        at,
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_person_who_did_nothing_and_was_not_seen_is_away(pool: PgPool) {
    insert_user(&pool, ADA).await;
    let repo = PgActivityRepo::new(pool);
    assert!(!repo.is_active(&user(ADA), week_ago()).await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_person_seen_in_the_window_is_active_and_one_seen_before_it_is_not(pool: PgPool) {
    insert_user(&pool, ADA).await;
    insert_user(&pool, BEA).await;
    let repo = PgActivityRepo::new(pool);
    let now = Utc::now();

    repo.record_seen(&[user(ADA)], now - Duration::days(8))
        .await
        .unwrap();
    assert!(!repo.is_active(&user(ADA), week_ago()).await.unwrap());

    repo.record_seen(&[user(ADA), user(BEA)], now - Duration::hours(1))
        .await
        .unwrap();
    assert!(repo.is_active(&user(ADA), week_ago()).await.unwrap());
    assert!(repo.is_active(&user(BEA), week_ago()).await.unwrap());
    // Asked about a shorter window, an hour-old visit is outside it.
    assert!(
        !repo
            .is_active(&user(ADA), now - Duration::minutes(30))
            .await
            .unwrap()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn recording_keeps_the_latest_visit_and_passes_over_unknown_ids(pool: PgPool) {
    insert_user(&pool, ADA).await;
    let repo = PgActivityRepo::new(pool.clone());
    let latest = Utc::now() - Duration::hours(1);

    repo.record_seen(&[user(ADA)], latest).await.unwrap();
    // A gateway whose batch is older, a repeated id, and an id with no Macro
    // user: the batch is written, the visit not moved back, the stranger left
    // out.
    repo.record_seen(
        &[user(ADA), user(ADA), user("macro|stranger@example.com")],
        latest - Duration::days(30),
    )
    .await
    .unwrap();

    let rows = sqlx::query!("SELECT user_id, seen_at FROM user_last_seen")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].user_id, ADA);
    assert_eq!(
        rows[0].seen_at.timestamp_micros(),
        latest.timestamp_micros()
    );
    repo.record_seen(&[], latest).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_person_who_changed_something_in_the_window_is_active(pool: PgPool) {
    insert_user(&pool, ADA).await;
    let repo = PgActivityRepo::new(pool);
    let now = Utc::now();

    repo.insert_activities(&[ada_edits(1, now - Duration::days(8))])
        .await
        .unwrap();
    assert!(!repo.is_active(&user(ADA), week_ago()).await.unwrap());

    repo.insert_activities(&[ada_edits(2, now - Duration::days(6))])
        .await
        .unwrap();
    assert!(repo.is_active(&user(ADA), week_ago()).await.unwrap());
    // Ada's edit says nothing of Bea.
    assert!(!repo.is_active(&user(BEA), week_ago()).await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn work_an_agent_does_for_a_person_does_not_make_them_active(pool: PgPool) {
    insert_user(&pool, ADA).await;
    let repo = PgActivityRepo::new(pool);
    let yesterday = Utc::now() - Duration::days(1);
    let bot = Actor::new_from_bot(bot_id::BotId::new_from_uuid(Uuid::from_u128(0xB07)));

    // A bot of Ada's edits for her: the row is hers, its actor the bot's.
    let delegated = on_a_document(1, bot, Some(ADA), CommonAction::Edited, yesterday);
    assert_eq!(delegated.subject_id, ADA);
    // A code-mode run under Ada's own identity: her actor, with the run's
    // correlation.
    let correlated =
        agent_correlation::context::scope(Some(Uuid::now_v7()), async { ada_edits(2, yesterday) })
            .await;
    assert!(correlated.agent_correlation_id.is_some());
    repo.insert_activities(&[delegated, correlated])
        .await
        .unwrap();

    assert!(!repo.is_active(&user(ADA), week_ago()).await.unwrap());
    assert!(
        repo.touched_between(ADA, week_ago(), Utc::now())
            .await
            .unwrap(),
        "the agent's work still counts as her day's activity for memory"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn views_and_appearance_changes_do_not_make_a_person_active(pool: PgPool) {
    insert_user(&pool, ADA).await;
    let repo = PgActivityRepo::new(pool);
    let yesterday = Utc::now() - Duration::days(1);
    let ada = || Actor::new_from_user(user(ADA));

    repo.insert_activities(&[
        on_a_document(1, ada(), None, CommonAction::Opened, yesterday),
        on_a_document(
            2,
            ada(),
            None,
            CommonAction::AppearanceChanged(AppearanceChange {
                from: None,
                to: None,
            }),
            yesterday,
        ),
    ])
    .await
    .unwrap();

    assert!(!repo.is_active(&user(ADA), week_ago()).await.unwrap());
    // Her newest change is what counts, not her newest row: views since an
    // edit before the week leave her away.
    repo.insert_activities(&[ada_edits(3, Utc::now() - Duration::days(8))])
        .await
        .unwrap();
    assert!(!repo.is_active(&user(ADA), week_ago()).await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_deleted_person_leaves_no_seen_time(pool: PgPool) {
    insert_user(&pool, ADA).await;
    let repo = PgActivityRepo::new(pool.clone());
    repo.record_seen(&[user(ADA)], Utc::now()).await.unwrap();

    sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, ADA)
        .execute(&pool)
        .await
        .unwrap();

    let left = sqlx::query_scalar!(r#"SELECT count(*) AS "left!" FROM user_last_seen"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(left, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_list_longer_than_one_statement_takes_is_recorded_whole(pool: PgPool) {
    let ids: Vec<String> = (0..=super::super::user_activity::SEEN_BATCH)
        .map(|n| format!("macro|person{n}@example.com"))
        .collect();
    for id in &ids {
        insert_user(&pool, id).await;
    }
    let repo = PgActivityRepo::new(pool.clone());
    let users: Vec<_> = ids.iter().map(|id| user(id)).collect();

    repo.record_seen(&users, Utc::now()).await.unwrap();

    let seen = sqlx::query_scalar!(r#"SELECT count(*) AS "seen!" FROM user_last_seen"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(seen, i64::try_from(ids.len()).unwrap());
}

/// The check's SQL and `idx_activity_events_own` spell out the actions that
/// are not changes, so the planner can match the query to the index. A tag
/// added here without them would count as a change in neither, or leave the
/// check reading a table the index no longer covers.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn non_touch_actions_are_the_ones_the_index_leaves_out(pool: PgPool) {
    assert_eq!(
        NON_TOUCH_ACTION_TAGS,
        ["opened", "appearance_changed"],
        "change the activity check's SQL and idx_activity_events_own with the tags"
    );
    let predicate = sqlx::query_scalar!(
        r#"
        SELECT pg_get_expr(indpred, indrelid) AS "predicate!"
        FROM pg_index
        WHERE indexrelid = 'idx_activity_events_own'::regclass
        "#
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let tags = NON_TOUCH_ACTION_TAGS
        .iter()
        .map(|tag| format!("'{tag}'::text"))
        .collect::<Vec<_>>()
        .join(", ");
    assert!(
        predicate.contains(&format!("action <> ALL (ARRAY[{tags}])")),
        "{predicate}"
    );
}
