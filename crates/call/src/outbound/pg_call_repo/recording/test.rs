use std::ops::Deref;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use super::super::test::{CALL1, USER_A, give_user_a_team, repo};
use crate::domain::ports::CallRepository;
use crate::domain::recording::{CallKinds, CallKindsPatch, CallTurnedExternal, RecordingRules};

const TEAM_ID: Uuid = Uuid::from_u128(0x7ea3_0000_0000_0000_0000_0000_0000_00c1);

async fn user_a_on_a_team(pool: &Pool<Postgres>) -> anyhow::Result<()> {
    give_user_a_team(pool, USER_A.as_ref(), &TEAM_ID).await
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn missing_rows_record_everything_and_block_nothing(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    user_a_on_a_team(&pool).await?;
    let repo = repo(pool);
    for team in [None, Some(TEAM_ID), Some(Uuid::now_v7())] {
        assert_eq!(
            repo.get_recording_rules(USER_A.deref().copied(), team)
                .await?,
            RecordingRules::default()
        );
    }
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn default_patches_merge_one_kind_at_a_time(pool: Pool<Postgres>) -> anyhow::Result<()> {
    user_a_on_a_team(&pool).await?;
    let repo = repo(pool);
    let huddles_off = repo
        .update_recording_defaults(
            USER_A.deref().copied(),
            CallKindsPatch {
                huddles: Some(false),
                ..CallKindsPatch::default()
            },
        )
        .await?;
    assert_eq!(
        huddles_off,
        CallKinds {
            huddles: false,
            ..CallKinds::ALL
        }
    );
    // A patch for another kind keeps the earlier one.
    let both_off = repo
        .update_recording_defaults(
            USER_A.deref().copied(),
            CallKindsPatch {
                external_meetings: Some(false),
                ..CallKindsPatch::default()
            },
        )
        .await?;
    assert_eq!(
        both_off,
        CallKinds {
            huddles: false,
            internal_meetings: true,
            external_meetings: false,
        }
    );
    let rules = repo
        .get_recording_rules(USER_A.deref().copied(), None)
        .await?;
    assert_eq!(rules.record_by_default, both_off);
    assert_eq!(rules.blocked, CallKinds::NONE);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn team_blocks_apply_only_to_their_team(pool: Pool<Postgres>) -> anyhow::Result<()> {
    user_a_on_a_team(&pool).await?;
    let repo = repo(pool);
    let blocked = repo
        .update_team_recording_blocks(
            &TEAM_ID,
            CallKindsPatch {
                internal_meetings: Some(true),
                ..CallKindsPatch::default()
            },
        )
        .await?;
    assert_eq!(
        blocked,
        CallKinds {
            internal_meetings: true,
            ..CallKinds::NONE
        }
    );
    let unblocked = repo
        .update_team_recording_blocks(
            &TEAM_ID,
            CallKindsPatch {
                internal_meetings: Some(false),
                huddles: Some(true),
                ..CallKindsPatch::default()
            },
        )
        .await?;
    assert_eq!(
        unblocked,
        CallKinds {
            huddles: true,
            ..CallKinds::NONE
        }
    );
    assert_eq!(
        repo.get_recording_rules(USER_A.deref().copied(), Some(TEAM_ID))
            .await?
            .blocked,
        unblocked
    );
    assert_eq!(
        repo.get_recording_rules(USER_A.deref().copied(), None)
            .await?
            .blocked,
        CallKinds::NONE
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn a_call_turns_external_once_and_reports_its_recorder(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    assert!(!repo.is_call_external(&CALL1).await?);
    repo.set_egress_id(&CALL1, "egress-1").await?;

    assert_eq!(
        repo.mark_call_external(&CALL1).await?,
        Some(CallTurnedExternal {
            egress_id: Some("egress-1".to_string()),
        })
    );
    assert!(repo.is_call_external(&CALL1).await?);
    assert_eq!(repo.mark_call_external(&CALL1).await?, None);

    // A call that is no longer live is neither flagged nor flaggable.
    let ended = Uuid::now_v7();
    assert_eq!(repo.mark_call_external(&ended).await?, None);
    assert!(!repo.is_call_external(&ended).await?);
    Ok(())
}
