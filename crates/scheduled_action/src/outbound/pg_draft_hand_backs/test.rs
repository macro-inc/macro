use super::*;
use crate::domain::event_trigger::ActionTrigger;
use crate::domain::models::{ActionConfiguration, ActionKind};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").unwrap()
}

fn check(name: &str) -> RoutineCheck {
    RoutineCheck {
        ok: true,
        problems: Vec::new(),
        steps: Vec::new(),
        routine: ActionConfiguration {
            name: name.into(),
            trigger: serde_json::from_value::<ActionTrigger>(serde_json::json!({
                "type": "once",
                "at": "2030-01-01T00:00:00Z",
            }))
            .unwrap(),
            kind: ActionKind::Agent,
            task: serde_json::json!({ "steps": [] }),
            enabled: true,
            run_visibility: Default::default(),
            description: String::new(),
        },
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_drafts_latest_check_by_its_owner_is_its_answer(pool: PgPool) {
    let drafts = PgDraftHandBacks::new(pool);
    let session = macro_uuid::generate_uuid_v7();
    drafts
        .begin(session, &owner(), bot_id::BotId::TEST_A)
        .await
        .unwrap();
    assert_eq!(drafts.handed_back(session).await.unwrap(), HandedBack::default());

    let stranger = MacroUserIdStr::try_from_email("stranger@example.com").unwrap();
    assert!(!drafts.record(session, &stranger, &check("Theirs")).await.unwrap());
    assert!(drafts.record(session, &owner(), &check("First")).await.unwrap());
    assert!(drafts.record(session, &owner(), &check("Bug reports")).await.unwrap());
    // A session that isn't a draft's keeps nothing.
    assert!(
        !drafts
            .record(macro_uuid::generate_uuid_v7(), &owner(), &check("Other"))
            .await
            .unwrap()
    );

    assert_eq!(
        drafts.handed_back(session).await.unwrap(),
        HandedBack {
            check: Some(check("Bug reports")),
            checks: 2,
        }
    );

    drafts.finish(session).await.unwrap();
    assert_eq!(drafts.handed_back(session).await.unwrap(), HandedBack::default());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_sweep_finds_only_drafts_started_before_its_cutoff(pool: PgPool) {
    let drafts = PgDraftHandBacks::new(pool.clone());
    let (old, new) = (macro_uuid::generate_uuid_v7(), macro_uuid::generate_uuid_v7());
    for session in [old, new] {
        drafts
            .begin(session, &owner(), bot_id::BotId::TEST_A)
            .await
            .unwrap();
    }
    sqlx::query!(
        "UPDATE scheduled_action_draft SET created_at = now() - interval '1 hour' WHERE session_id = $1",
        old
    )
    .execute(&pool)
    .await
    .unwrap();

    let stale = drafts
        .stale(Utc::now() - chrono::Duration::minutes(10), 10)
        .await
        .unwrap();

    assert_eq!(
        stale,
        [StaleDraft {
            session: old,
            owner: owner(),
            agent: bot_id::BotId::TEST_A,
        }]
    );
}
