use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::json;
use sqlx::PgPool;

use super::*;
use crate::domain::ports::ScheduledActionRepo;
use crate::outbound::pg_scheduled_action_repo::test::{
    USER_A, insert_user, sample_action, test_repo, user_owner,
};

fn sdk(value: &str) -> SdkFingerprint {
    value.to_owned().try_into().unwrap()
}

async fn routine(pool: &PgPool) -> ScheduledAction {
    insert_user(pool, USER_A).await;
    let mut action = sample_action(user_owner(USER_A), "File invoices");
    action.task = json!({
        "steps": [{ "type": "code", "title": "File", "source": "old" }],
        "sdk": "0.2.0+old",
    });
    test_repo(pool.clone())
        .create_action(action, None)
        .await
        .unwrap()
}

async fn stored(pool: &PgPool, action: &ScheduledAction) -> ScheduledAction {
    test_repo(pool.clone())
        .get_action(&action.id.unwrap())
        .await
        .unwrap()
        .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn checked_code_records_its_new_sdk_without_a_new_revision(pool: PgPool) {
    let upgrades = PgCodeUpgrades::new(pool.clone());
    let action = routine(&pool).await;
    upgrades
        .record_checked(&action, &sdk("0.3.0+new"))
        .await
        .unwrap();
    let saved = stored(&pool, &action).await;
    assert_eq!(saved.task["sdk"], "0.3.0+new");
    assert_eq!(saved.task["steps"], action.task["steps"]);
    assert_eq!(saved.configuration_revision, action.configuration_revision);
    let history = upgrades.list_upgrades(action.id.unwrap()).await.unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].outcome, UpgradeOutcome::Checked);
    assert_eq!(history[0].from_sdk.as_deref(), Some("0.2.0+old"));
    assert_eq!(history[0].previous_task, action.task);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn one_run_claims_the_rewrite_for_an_sdk(pool: PgPool) {
    let upgrades = PgCodeUpgrades::new(pool.clone());
    let action = routine(&pool).await;
    assert!(
        upgrades
            .claim_rewrite(&action, &sdk("0.3.0+new"))
            .await
            .unwrap()
    );
    assert!(
        !upgrades
            .claim_rewrite(&action, &sdk("0.3.0+new"))
            .await
            .unwrap()
    );
    // A newer SDK is a new upgrade.
    assert!(
        upgrades
            .claim_rewrite(&action, &sdk("0.4.0+newer"))
            .await
            .unwrap()
    );
    // A claim abandoned by a stopped process can be taken over.
    sqlx::query!(
        "UPDATE scheduled_action_code_upgrade SET updated_at = now() - interval '1 hour' WHERE to_sdk = '0.3.0+new'"
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        upgrades
            .claim_rewrite(&action, &sdk("0.3.0+new"))
            .await
            .unwrap()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_saved_rewrite_replaces_the_task_unless_the_owner_changed_it(pool: PgPool) {
    let upgrades = PgCodeUpgrades::new(pool.clone());
    let action = routine(&pool).await;
    let new = sdk("0.3.0+new");
    upgrades.claim_rewrite(&action, &new).await.unwrap();
    let rewritten = json!({
        "steps": [{ "type": "code", "title": "File", "source": "new" }],
        "sdk": "0.3.0+new",
    });
    upgrades
        .save_rewrite(&action, &new, &rewritten)
        .await
        .unwrap();
    let saved = stored(&pool, &action).await;
    assert_eq!(saved.task, rewritten);
    assert_eq!(saved.configuration_revision, action.configuration_revision);
    let history = upgrades.list_upgrades(action.id.unwrap()).await.unwrap();
    assert_eq!(history[0].outcome, UpgradeOutcome::Rewritten);
    assert_eq!(history[0].task.as_ref(), Some(&rewritten));

    // An owner's edit since the run started wins over a rewrite.
    let mut edited = saved.clone();
    edited.configuration_revision = edited.configuration_revision.next().unwrap();
    edited.task = json!({ "steps": [{ "type": "code", "title": "File", "source": "owner" }] });
    let edited = test_repo(pool.clone())
        .update_action(edited, None)
        .await
        .unwrap();
    let newer = sdk("0.4.0+newer");
    upgrades.claim_rewrite(&saved, &newer).await.unwrap();
    upgrades
        .save_rewrite(&saved, &newer, &rewritten)
        .await
        .unwrap();
    assert_eq!(stored(&pool, &action).await.task, edited.task);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn needing_an_update_pauses_the_routine_with_the_reason(pool: PgPool) {
    let upgrades = PgCodeUpgrades::new(pool.clone());
    let action = routine(&pool).await;
    let new = sdk("0.3.0+new");
    upgrades.claim_rewrite(&action, &new).await.unwrap();
    let proposal = json!({ "steps": [], "sdk": "0.3.0+new" });
    upgrades
        .needs_update(
            &action,
            &new,
            "the update failed a dry run",
            Some(&proposal),
        )
        .await
        .unwrap();
    assert!(!stored(&pool, &action).await.enabled);
    let history = upgrades.list_upgrades(action.id.unwrap()).await.unwrap();
    assert_eq!(history[0].outcome, UpgradeOutcome::NeedsUpdate);
    assert_eq!(
        history[0].reason.as_deref(),
        Some("the update failed a dry run")
    );
    assert_eq!(history[0].task.as_ref(), Some(&proposal));
}

/// Checks pass for every source; no runs, no rewrites.
struct Checks;

impl crate::domain::ports::RoutineCode for Checks {
    fn sdk(&self) -> Option<SdkFingerprint> {
        Some(sdk("0.3.0+new"))
    }

    async fn check_program(
        &self,
        _: &routine_program::RoutineProgram,
    ) -> std::result::Result<
        Vec<crate::domain::ports::StepProblems>,
        crate::domain::ports::CodeUnavailable,
    > {
        Ok(Vec::new())
    }

    async fn owner_time_zone(
        &self,
        _: &macro_user_id::user_id::MacroUserIdStr<'static>,
    ) -> Option<String> {
        None
    }

    async fn run(
        &self,
        _: &macro_user_id::user_id::MacroUserIdStr<'static>,
        _: crate::domain::ports::CodeRun<'_>,
    ) -> crate::domain::ports::CodeOutcome {
        unreachable!("checked code isn't run by a sweep")
    }

    async fn reference(
        &self,
        _: &macro_user_id::user_id::MacroUserIdStr<'static>,
        _: &str,
    ) -> std::result::Result<String, crate::domain::ports::CodeUnavailable> {
        Ok(String::new())
    }

    fn declarations(&self, _: &[String]) -> String {
        String::new()
    }

    async fn rewrite(
        &self,
        _: &macro_user_id::user_id::MacroUserIdStr<'static>,
        _: &routine_program::CodeStep,
        _: &str,
        _: &[String],
    ) -> std::result::Result<String, String> {
        unreachable!("checked code isn't rewritten")
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_sweep_brings_enabled_routines_with_code_to_the_current_sdk(pool: PgPool) {
    let repo = test_repo(pool.clone());
    let upgrades = PgCodeUpgrades::new(pool.clone());
    insert_user(&pool, USER_A).await;
    let create = |task: Value, enabled: bool| {
        let mut action = sample_action(user_owner(USER_A), "routine");
        action.task = task;
        action.enabled = enabled;
        action
    };
    let nested = repo
        .create_action(
            create(
                json!({ "steps": [
                { "type": "agent", "model": "m", "instructions": "Read" },
                { "type": "code", "title": "File", "source": "old" }
            ], "sdk": "0.2.0+old" }),
                true,
            ),
            None,
        )
        .await
        .unwrap();
    let never_checked = repo
        .create_action(
            create(
                json!({ "steps": [{ "type": "code", "title": "File", "source": "old" }] }),
                true,
            ),
            None,
        )
        .await
        .unwrap();
    let current = repo
        .create_action(create(
            json!({ "steps": [{ "type": "code", "title": "File", "source": "new" }], "sdk": "0.3.0+new" }),
            true,
        ), None)
        .await
        .unwrap();
    let paused = repo
        .create_action(create(
            json!({ "steps": [{ "type": "code", "title": "File", "source": "old" }], "sdk": "0.2.0+old" }),
            false,
        ), None)
        .await
        .unwrap();
    let no_code = repo
        .create_action(
            create(
                json!({ "steps": [{ "type": "agent", "model": "m", "instructions": "Go" }] }),
                true,
            ),
            None,
        )
        .await
        .unwrap();

    let mut stale = upgrades
        .stale_routines(&sdk("0.3.0+new"), None, 1)
        .await
        .unwrap();
    stale.extend(
        upgrades
            .stale_routines(&sdk("0.3.0+new"), stale.last().copied(), 10)
            .await
            .unwrap(),
    );
    let mut expected = vec![nested.id.unwrap(), never_checked.id.unwrap()];
    expected.sort();
    assert_eq!(stale, expected);

    let swept = crate::domain::code_upgrade::sweep(
        &Checks,
        &upgrades,
        &repo,
        &tokio_util::sync::CancellationToken::new(),
    )
    .await
    .unwrap();
    assert_eq!(swept.upgraded, 2);
    for action in [&nested, &never_checked, &current] {
        assert_eq!(stored(&pool, action).await.task["sdk"], "0.3.0+new");
    }
    assert_eq!(stored(&pool, &paused).await.task["sdk"], "0.2.0+old");
    assert_eq!(stored(&pool, &no_code).await.task.get("sdk"), None);
    assert!(
        upgrades
            .stale_routines(&sdk("0.3.0+new"), None, 10)
            .await
            .unwrap()
            .is_empty()
    );
}
