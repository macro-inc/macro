use agent_fold::domain::log::AgentSessionId;
use bot_id::BotId;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use messages::domain::models::MessageParent;

use super::*;
use crate::domain::model::{AgentKind, FeedbackSubject, Note, ResponseContext, Surface};

const RATER: &str = "macro|pg-rater@example.com";
const OTHER: &str = "macro|pg-other@example.com";
const SESSION: Uuid = Uuid::from_u128(0x5E55);
const CHANNEL: Uuid = Uuid::from_u128(0xC4A7);

async fn insert_user(pool: &PgPool, id: &str, is_agent: bool) {
    let macro_user_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
        macro_user_id,
        id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id, "isAgent") VALUES ($1, $1, $2, $3)"#,
        id,
        macro_user_id,
        is_agent,
    )
    .execute(pool)
    .await
    .unwrap();
}

fn rater() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(RATER.to_owned()).unwrap()
}

fn on_turn(turn: u32) -> FeedbackSubject {
    FeedbackSubject::AgentSessionTurn {
        session_id: AgentSessionId::new_from_uuid(SESSION),
        turn,
    }
}

fn write(
    id: Uuid,
    subject: FeedbackSubject,
    rating: Option<Rating>,
    note: Option<&str>,
) -> FeedbackWrite {
    FeedbackWrite {
        id,
        user: rater(),
        subject,
        rating,
        note: Note::parse(note.map(str::to_owned)).unwrap(),
        surface: Surface::AgentsView,
        context: ResponseContext {
            message_parent_type: None,
            agent_session_id: Some(AgentSessionId::new_from_uuid(SESSION)),
            agent_bot_id: Some(BotId::TEST_A),
            agent_user_id: None,
            agent_kind: Some(AgentKind::OwnedBot),
            harness: Some("claude_code".to_owned()),
            model: Some("claude-opus-5-5".to_owned()),
        },
        trace_id: Some("4bf92f3577b34da6a3ce929d0e0e4736".to_owned()),
    }
}

/// A retry, a repeat, a change and a retraction each do what the port says,
/// and the person's current state is their newest row.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn appends_only_what_changes(pool: PgPool) {
    insert_user(&pool, RATER, false).await;
    let repo = PgFeedbackRepo::new(pool.clone());
    let first = Uuid::now_v7();

    let created = repo
        .append_if_changed(&write(first, on_turn(0), Some(Rating::Up), None))
        .await
        .unwrap();
    let replayed = repo
        .append_if_changed(&write(first, on_turn(0), Some(Rating::Up), None))
        .await
        .unwrap();
    let unchanged = repo
        .append_if_changed(&write(Uuid::now_v7(), on_turn(0), Some(Rating::Up), None))
        .await
        .unwrap();
    let changed = repo
        .append_if_changed(&write(
            Uuid::now_v7(),
            on_turn(0),
            Some(Rating::Down),
            Some("wrong file"),
        ))
        .await
        .unwrap();
    let id_taken = repo
        .append_if_changed(&write(first, on_turn(1), Some(Rating::Up), None))
        .await
        .unwrap();
    let retracted = repo
        .append_if_changed(&write(Uuid::now_v7(), on_turn(0), None, None))
        .await
        .unwrap();
    let retracted_again = repo
        .append_if_changed(&write(Uuid::now_v7(), on_turn(0), None, None))
        .await
        .unwrap();

    let AppendOutcome::Created(created) = created else {
        panic!("first rating was not written: {created:?}");
    };
    assert_eq!(created.rating, Some(Rating::Up));
    assert_eq!(replayed, AppendOutcome::Replayed(created.clone()));
    assert_eq!(unchanged, AppendOutcome::Unchanged(created));
    let AppendOutcome::Created(changed) = changed else {
        panic!("change was not written: {changed:?}");
    };
    assert_eq!(changed.rating, Some(Rating::Down));
    assert_eq!(changed.note.as_deref(), Some("wrong file"));
    assert_eq!(id_taken, AppendOutcome::IdTaken);
    assert!(matches!(
        retracted,
        AppendOutcome::Created(FeedbackState { rating: None, .. })
    ));
    assert!(matches!(
        retracted_again,
        AppendOutcome::Unchanged(FeedbackState { rating: None, .. })
    ));

    let rows = sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM agent_response_feedback"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(rows, 3);
}

/// `mine` is the newest row per response in the container, without
/// retractions, other people's rows or other containers.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn current_ratings_are_the_newest_unretracted_rows(pool: PgPool) {
    insert_user(&pool, RATER, false).await;
    insert_user(&pool, OTHER, false).await;
    let repo = PgFeedbackRepo::new(pool.clone());
    for (subject, rating) in [
        (on_turn(0), Some(Rating::Up)),
        (on_turn(0), Some(Rating::Down)),
        (on_turn(1), Some(Rating::Up)),
        (on_turn(1), None),
        (on_turn(2), Some(Rating::Up)),
    ] {
        repo.append_if_changed(&write(Uuid::now_v7(), subject, rating, None))
            .await
            .unwrap();
    }
    let mut someone_else = write(Uuid::now_v7(), on_turn(3), Some(Rating::Up), None);
    someone_else.user = MacroUserIdStr::try_from(OTHER.to_owned()).unwrap();
    repo.append_if_changed(&someone_else).await.unwrap();
    repo.append_if_changed(&write(
        Uuid::now_v7(),
        FeedbackSubject::Message {
            parent: MessageParent::Channel(CHANNEL),
            message_id: Uuid::now_v7(),
        },
        Some(Rating::Up),
        None,
    ))
    .await
    .unwrap();

    let mine = repo
        .current_in_container(
            &rater(),
            SubjectKind::AgentSessionTurn,
            &SESSION.to_string(),
        )
        .await
        .unwrap();

    let turns: Vec<_> = mine.iter().map(|item| (item.turn, item.rating)).collect();
    assert_eq!(turns, vec![(Some(0), Rating::Down), (Some(2), Rating::Up)]);
}

/// Export pages cover every row exactly once, retractions included, and the
/// context recorded with each.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn export_pages_cover_every_row_once(pool: PgPool) {
    insert_user(&pool, RATER, false).await;
    let repo = PgFeedbackRepo::new(pool.clone());
    let mut written = Vec::new();
    for (turn, rating) in [
        (0, Some(Rating::Up)),
        (0, None),
        (1, Some(Rating::Down)),
        (2, Some(Rating::Up)),
        (3, Some(Rating::Up)),
    ] {
        let id = Uuid::now_v7();
        repo.append_if_changed(&write(id, on_turn(turn), rating, None))
            .await
            .unwrap();
        written.push(id);
    }

    let two = ExportLimit::new(2).unwrap();
    let mut seen = Vec::new();
    let mut after = None;
    loop {
        let page = repo.events_after(after, two).await.unwrap();
        let Some(last) = page.last() else {
            break;
        };
        after = Some(ExportCursor {
            after_created_at: last.created_at,
            after_id: last.id,
        });
        seen.extend(page);
    }

    assert_eq!(
        seen.iter().map(|event| event.id).collect::<Vec<_>>(),
        written
    );
    assert_eq!(seen[1].rating, None);
    assert_eq!(seen[0].agent_kind, Some(AgentKind::OwnedBot));
    assert_eq!(seen[0].agent_bot_id, Some(BotId::TEST_A.as_uuid()));
    assert_eq!(seen[0].model.as_deref(), Some("claude-opus-5-5"));
    assert_eq!(seen[0].subject_kind, SubjectKind::AgentSessionTurn);
    assert_eq!(seen[0].surface, Surface::AgentsView);
}

/// Deleting a person deletes their ratings.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn ratings_go_with_the_person(pool: PgPool) {
    insert_user(&pool, RATER, false).await;
    let repo = PgFeedbackRepo::new(pool.clone());
    repo.append_if_changed(&write(Uuid::now_v7(), on_turn(0), Some(Rating::Up), None))
        .await
        .unwrap();

    sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, RATER)
        .execute(&pool)
        .await
        .unwrap();

    let rows = sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM agent_response_feedback"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(rows, 0);
}

/// The table refuses a turn on a non-turn subject, a missing turn, and a
/// note without a rating.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_table_refuses_inconsistent_rows(pool: PgPool) {
    insert_user(&pool, RATER, false).await;
    for (kind, turn, rating, note) in [
        ("message", Some(0), Some("up"), None),
        ("agent_session_turn", None, Some("up"), None),
        ("agent_session_turn", Some(0), None, Some("a note")),
    ] {
        let inserted = sqlx::query!(
            r#"INSERT INTO agent_response_feedback
                   (id, user_id, subject_kind, container_id, subject_id, turn, rating, note, surface)
               VALUES ($1, $2, $3::text::agent_response_feedback_subject, 'c', $4, $5,
                   $6::text::agent_response_rating, $7, 'agents_view')"#,
            Uuid::now_v7(),
            RATER,
            kind,
            Uuid::now_v7(),
            turn,
            rating,
            note,
        )
        .execute(&pool)
        .await;
        assert!(
            inserted.is_err(),
            "{kind} {turn:?} {rating:?} {note:?} was stored"
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn agent_accounts_are_the_users_marked_as_agents(pool: PgPool) {
    insert_user(&pool, RATER, false).await;
    insert_user(&pool, OTHER, true).await;
    let repo = PgFeedbackRepo::new(pool);

    let person = repo.is_agent_account(&rater()).await.unwrap();
    let agent = repo
        .is_agent_account(&MacroUserIdStr::try_from(OTHER.to_owned()).unwrap())
        .await
        .unwrap();
    let unknown = repo
        .is_agent_account(&MacroUserIdStr::try_from("macro|nobody@example.com".to_owned()).unwrap())
        .await
        .unwrap();

    assert!(!person);
    assert!(agent);
    assert!(!unknown);
}
