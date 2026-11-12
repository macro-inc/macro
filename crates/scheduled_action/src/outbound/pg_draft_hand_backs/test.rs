use super::*;
use crate::domain::event_trigger::ActionTrigger;
use crate::domain::models::{ActionConfiguration, ActionKind, CreatedItem};
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
    assert_eq!(
        drafts.handed_back(session).await.unwrap(),
        HandedBack::default()
    );

    let stranger = MacroUserIdStr::try_from_email("stranger@example.com").unwrap();
    let database = CreatedItem {
        entity_type: model_entity::EntityType::Database,
        entity_id: "bug-log".into(),
    };
    let folder = CreatedItem {
        entity_type: model_entity::EntityType::Project,
        entity_id: "reports".into(),
    };
    assert!(
        !drafts
            .record(session, &stranger, &check("Theirs"), &[folder.clone()])
            .await
            .unwrap()
    );
    assert!(
        drafts
            .record(session, &owner(), &check("First"), &[database.clone()])
            .await
            .unwrap()
    );
    assert!(
        drafts
            .record(
                session,
                &owner(),
                &check("Bug reports"),
                &[database.clone(), folder.clone()]
            )
            .await
            .unwrap()
    );
    // A session that isn't a draft's keeps nothing.
    assert!(
        !drafts
            .record(
                macro_uuid::generate_uuid_v7(),
                &owner(),
                &check("Other"),
                &[]
            )
            .await
            .unwrap()
    );

    let mut handed_back = drafts.handed_back(session).await.unwrap();
    handed_back
        .created
        .sort_by(|a, b| a.entity_id.cmp(&b.entity_id));
    assert_eq!(
        handed_back,
        HandedBack {
            check: Some(check("Bug reports")),
            passed: Some(check("Bug reports")),
            checks: 2,
            // Each item once, across checks.
            created: vec![database, folder],
            cancelled: false,
        }
    );

    drafts.finish(session).await.unwrap();
    assert_eq!(
        drafts.handed_back(session).await.unwrap(),
        HandedBack::default()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_sweep_finds_only_drafts_started_before_its_cutoff(pool: PgPool) {
    let drafts = PgDraftHandBacks::new(pool.clone());
    let (old, new) = (
        macro_uuid::generate_uuid_v7(),
        macro_uuid::generate_uuid_v7(),
    );
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_failing_check_keeps_the_last_passing_one(pool: PgPool) {
    let drafts = PgDraftHandBacks::new(pool);
    let session = macro_uuid::generate_uuid_v7();
    drafts
        .begin(session, &owner(), bot_id::BotId::TEST_A)
        .await
        .unwrap();
    let failing = RoutineCheck {
        ok: false,
        problems: vec!["no schedule".into()],
        ..check("Later")
    };
    drafts
        .record(session, &owner(), &check("Passing"), &[])
        .await
        .unwrap();
    drafts
        .record(session, &owner(), &failing, &[])
        .await
        .unwrap();

    let handed_back = drafts.handed_back(session).await.unwrap();
    assert_eq!(handed_back.check, Some(failing));
    assert_eq!(handed_back.passed, Some(check("Passing")));
}

/// The blocking sweep leaves background drafts alone, however old: their
/// rows outlive their drafter until opened.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_blocking_sweep_skips_background_drafts(pool: PgPool) {
    let drafts = PgDraftHandBacks::new(pool.clone());
    let (job, waited) = (
        macro_uuid::generate_uuid_v7(),
        macro_uuid::generate_uuid_v7(),
    );
    for session in [job, waited] {
        drafts
            .begin(session, &owner(), bot_id::BotId::TEST_A)
            .await
            .unwrap();
    }
    sqlx::query!(
        "UPDATE scheduled_action_draft SET state = 'ready', finished_at = now() WHERE session_id = $1",
        job
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE scheduled_action_draft SET created_at = now() - interval '1 hour'"
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
            session: waited,
            owner: owner(),
            agent: bot_id::BotId::TEST_A,
        }]
    );
}

mod jobs {
    use super::*;
    use crate::domain::drafts::jobs::{
        CancelledJob, DraftAsked, DraftJobState, DraftKind, Finished, InterruptedJob, NewDraftJob,
    };
    use crate::domain::drafts::progress::DraftStage;

    const TRACEPARENT: &str = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

    fn started(stage: DraftStage) -> DraftJobProgress {
        DraftJobProgress {
            stage,
            ..Default::default()
        }
    }

    async fn begin(drafts: &PgDraftHandBacks, owner: &MacroUserIdStr<'static>) -> Uuid {
        let session = macro_uuid::generate_uuid_v7();
        drafts
            .begin_job(&NewDraftJob {
                session,
                owner: owner.clone(),
                agent: bot_id::BotId::TEST_A,
                request: DraftAsked {
                    kind: DraftKind::Routine,
                    description: "label invoices".into(),
                },
                progress: started(DraftStage::Started),
                created_at: Utc::now(),
                traceparent: Some(TRACEPARENT.into()),
            })
            .await
            .unwrap();
        session
    }

    fn failed(message: &str) -> Draft {
        Draft::Failed {
            message: message.into(),
            created: Vec::new(),
        }
    }

    async fn age(pool: &PgPool, session: Uuid, created: &str, finished: Option<&str>) {
        sqlx::query!(
            "UPDATE scheduled_action_draft SET created_at = now() - $2::text::interval, finished_at = now() - $3::text::interval WHERE session_id = $1",
            session,
            created,
            finished,
        )
        .execute(pool)
        .await
        .unwrap();
    }

    fn stranger() -> MacroUserIdStr<'static> {
        MacroUserIdStr::try_from_email("stranger@example.com").unwrap()
    }

    #[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
    async fn a_job_keeps_its_progress_and_result_for_its_owner(pool: PgPool) {
        let drafts = PgDraftHandBacks::new(pool);
        let session = begin(&drafts, &owner()).await;
        let other = begin(&drafts, &stranger()).await;

        assert_eq!(drafts.drafting(&owner()).await.unwrap(), 1);
        assert!(
            drafts
                .progress(session, &started(DraftStage::Writing))
                .await
                .unwrap()
        );
        let job = drafts.job(&owner(), session).await.unwrap().unwrap();
        assert_eq!(job.id, session);
        assert_eq!(job.state, DraftJobState::Drafting);
        assert_eq!(job.progress.stage, DraftStage::Writing);
        assert_eq!(job.request.description, "label invoices");
        assert_eq!(drafts.jobs(&owner(), 20).await.unwrap(), [job]);
        // Nobody else reads it.
        assert_eq!(drafts.job(&stranger(), session).await.unwrap(), None);
        assert_eq!(drafts.jobs(&stranger(), 20).await.unwrap()[0].id, other);

        assert_eq!(
            drafts.finish_job(session, &failed("no")).await.unwrap(),
            Finished::Written
        );
        // Finished, it takes no more progress and no second result.
        assert!(
            !drafts
                .progress(session, &started(DraftStage::Fixing))
                .await
                .unwrap()
        );
        assert_eq!(
            drafts.finish_job(session, &failed("again")).await.unwrap(),
            Finished::Gone
        );
        assert_eq!(drafts.drafting(&owner()).await.unwrap(), 0);
        let finished = drafts.job(&owner(), session).await.unwrap().unwrap();
        assert!(
            matches!(&finished.state, DraftJobState::Failed { message, .. } if message == "no"),
            "{finished:?}"
        );
        assert_eq!(finished.progress.stage, DraftStage::Writing);
        assert!(!drafts.handed_back(session).await.unwrap().cancelled);
    }

    #[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
    async fn cancelling_hides_a_job_and_tells_its_drafter(pool: PgPool) {
        let drafts = PgDraftHandBacks::new(pool);
        let drafting = begin(&drafts, &owner()).await;
        let finished = begin(&drafts, &owner()).await;
        drafts.finish_job(finished, &failed("no")).await.unwrap();

        assert_eq!(drafts.cancel_job(&stranger(), drafting).await.unwrap(), None);
        let cancelled = drafts.cancel_job(&owner(), drafting).await.unwrap();
        assert_eq!(
            cancelled,
            Some(CancelledJob {
                finished: false,
                agent: bot_id::BotId::TEST_A,
                progress: started(DraftStage::Started),
                traceparent: Some(TRACEPARENT.into()),
            })
        );
        assert!(drafts.handed_back(drafting).await.unwrap().cancelled);
        assert_eq!(drafts.job(&owner(), drafting).await.unwrap(), None);
        // Its drafter, finishing late, learns it was cancelled.
        assert_eq!(
            drafts.finish_job(drafting, &failed("no")).await.unwrap(),
            Finished::Cancelled
        );
        assert_eq!(drafts.cancel_job(&owner(), drafting).await.unwrap(), None);
        assert!(
            drafts
                .cancel_job(&owner(), finished)
                .await
                .unwrap()
                .unwrap()
                .finished
        );
        assert!(drafts.jobs(&owner(), 20).await.unwrap().is_empty());
    }

    #[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
    async fn the_job_sweep_fails_dead_drafts_and_finds_what_to_delete(pool: PgPool) {
        let drafts = PgDraftHandBacks::new(pool.clone());
        let died = begin(&drafts, &owner()).await;
        let running = begin(&drafts, &owner()).await;
        let unopened = begin(&drafts, &owner()).await;
        let forgotten = begin(&drafts, &owner()).await;
        let abandoned = begin(&drafts, &owner()).await;
        for session in [unopened, forgotten] {
            drafts.finish_job(session, &failed("no")).await.unwrap();
        }
        drafts.cancel_job(&owner(), abandoned).await.unwrap();
        age(&pool, died, "10 minutes", None).await;
        age(&pool, unopened, "2 days", Some("1 day")).await;
        age(&pool, forgotten, "9 days", Some("8 days")).await;
        age(&pool, abandoned, "10 minutes", None).await;
        let cutoff = Utc::now() - chrono::Duration::minutes(5);
        let stale = |session| StaleDraft {
            session,
            owner: owner(),
            agent: bot_id::BotId::TEST_A,
        };

        let interrupted = drafts
            .interrupt(cutoff, &failed("stopped"), 10)
            .await
            .unwrap();

        assert_eq!(
            interrupted,
            [InterruptedJob {
                draft: stale(died),
                progress: started(DraftStage::Started),
                traceparent: Some(TRACEPARENT.into()),
            }]
        );
        let failed_job = drafts.job(&owner(), died).await.unwrap().unwrap();
        assert!(
            matches!(&failed_job.state, DraftJobState::Failed { message, .. } if message == "stopped"),
            "{failed_job:?}"
        );
        // A drafter that outlived its sweep keeps nothing.
        assert_eq!(
            drafts.finish_job(died, &failed("late")).await.unwrap(),
            Finished::Gone
        );
        assert!(drafts.interrupt(cutoff, &failed("stopped"), 10).await.unwrap().is_empty());
        assert_eq!(
            drafts.job(&owner(), running).await.unwrap().unwrap().state,
            DraftJobState::Drafting
        );
        assert_eq!(drafts.abandoned(cutoff, 10).await.unwrap(), [stale(abandoned)]);
        assert_eq!(
            drafts
                .expired(Utc::now() - chrono::Duration::days(7), 10)
                .await
                .unwrap(),
            [stale(forgotten)]
        );
    }
}
