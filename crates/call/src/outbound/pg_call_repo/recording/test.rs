use std::ops::Deref;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use super::super::test::{CALL1, USER_A, USER_B, USER_C, give_user_a_team, repo};
use crate::domain::ports::CallRepository;
use crate::domain::recording::{
    CallKinds, CallKindsPatch, CallPreferences, MeetingAttendance, MeetingKindChange,
    RecordingRules, ShareAudience, ShareByDefault, ShareByDefaultPatch, UpdateCallSettingsRequest,
    UpdateTeamCallPolicyRequest,
};

const TEAM_ID: Uuid = Uuid::from_u128(0x7ea3_0000_0000_0000_0000_0000_0000_00c1);

async fn user_a_on_a_team(pool: &Pool<Postgres>) -> anyhow::Result<()> {
    give_user_a_team(pool, USER_A.as_ref(), &TEAM_ID).await
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn missing_rows_record_share_and_block_nothing(pool: Pool<Postgres>) -> anyhow::Result<()> {
    user_a_on_a_team(&pool).await?;
    let repo = repo(pool);
    for team in [None, Some(TEAM_ID), Some(Uuid::now_v7())] {
        assert_eq!(
            repo.get_call_preferences(USER_A.deref().copied(), team)
                .await?,
            CallPreferences::default()
        );
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
async fn settings_patches_merge_one_setting_at_a_time(pool: Pool<Postgres>) -> anyhow::Result<()> {
    user_a_on_a_team(&pool).await?;
    let repo = repo(pool);
    repo.update_call_preferences(
        USER_A.deref().copied(),
        UpdateCallSettingsRequest {
            record_by_default: CallKindsPatch {
                huddles: Some(false),
                ..CallKindsPatch::default()
            },
            ..UpdateCallSettingsRequest::default()
        },
    )
    .await?;
    // Patches to other settings keep the earlier ones.
    repo.update_call_preferences(
        USER_A.deref().copied(),
        UpdateCallSettingsRequest {
            record_by_default: CallKindsPatch {
                external_meetings: Some(false),
                ..CallKindsPatch::default()
            },
            share_by_default: ShareByDefaultPatch {
                huddles: Some(ShareAudience::Team),
                internal_meetings: Some(ShareAudience::Participants),
                ..ShareByDefaultPatch::default()
            },
            refuse_one_on_one_recording: None,
        },
    )
    .await?;
    repo.update_call_preferences(
        USER_A.deref().copied(),
        UpdateCallSettingsRequest {
            refuse_one_on_one_recording: Some(true),
            ..UpdateCallSettingsRequest::default()
        },
    )
    .await?;
    let preferences = repo
        .get_call_preferences(USER_A.deref().copied(), None)
        .await?;
    assert_eq!(
        preferences,
        CallPreferences {
            recording: RecordingRules {
                record_by_default: CallKinds {
                    huddles: false,
                    external_meetings: false,
                    ..CallKinds::ALL
                },
                blocked: CallKinds::NONE,
            },
            share_by_default: ShareByDefault {
                huddles: ShareAudience::Team,
                internal_meetings: ShareAudience::Participants,
                ..ShareByDefault::default()
            },
            huddle_sharing_blocked: false,
            refuses_one_on_one_recording: true,
        }
    );
    assert_eq!(
        repo.get_recording_rules(USER_A.deref().copied(), None)
            .await?,
        preferences.recording
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn team_blocks_apply_only_to_their_team(pool: Pool<Postgres>) -> anyhow::Result<()> {
    user_a_on_a_team(&pool).await?;
    let repo = repo(pool);
    repo.update_team_call_policy(
        &TEAM_ID,
        UpdateTeamCallPolicyRequest {
            recording_blocked: CallKindsPatch {
                one_on_ones: Some(true),
                internal_meetings: Some(true),
                ..CallKindsPatch::default()
            },
            huddle_sharing_blocked: Some(true),
        },
    )
    .await?;
    repo.update_team_call_policy(
        &TEAM_ID,
        UpdateTeamCallPolicyRequest {
            recording_blocked: CallKindsPatch {
                internal_meetings: Some(false),
                huddles: Some(true),
                ..CallKindsPatch::default()
            },
            huddle_sharing_blocked: None,
        },
    )
    .await?;
    let team = repo
        .get_call_preferences(USER_A.deref().copied(), Some(TEAM_ID))
        .await?;
    assert_eq!(
        team.recording.blocked,
        CallKinds {
            huddles: true,
            one_on_ones: true,
            ..CallKinds::NONE
        }
    );
    assert!(team.huddle_sharing_blocked);
    let no_team = repo
        .get_call_preferences(USER_A.deref().copied(), None)
        .await?;
    assert_eq!(no_team.recording.blocked, CallKinds::NONE);
    assert!(!no_team.huddle_sharing_blocked);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn only_people_who_refuse_are_listed(pool: Pool<Postgres>) -> anyhow::Result<()> {
    user_a_on_a_team(&pool).await?;
    let repo = repo(pool);
    let people = [USER_A.to_string(), USER_B.to_string()];
    assert!(repo.get_one_on_one_refusers(&people).await?.is_empty());
    repo.update_call_preferences(
        USER_A.deref().copied(),
        UpdateCallSettingsRequest {
            refuse_one_on_one_recording: Some(true),
            ..UpdateCallSettingsRequest::default()
        },
    )
    .await?;
    assert_eq!(
        repo.get_one_on_one_refusers(&people).await?,
        vec![USER_A.to_string()]
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn direct_messages_list_their_current_participants(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let dm = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO comms_channels (id, name, channel_type, owner_id, created_at, updated_at)
           VALUES ($1, NULL, 'direct_message', $2, now(), now())"#,
    )
    .bind(dm)
    .bind(USER_A.as_ref())
    .execute(&pool)
    .await?;
    for (user_id, left) in [
        (USER_A.as_ref(), false),
        (USER_B.as_ref(), false),
        ("bot-123", false),
        (USER_C.as_ref(), true),
    ] {
        sqlx::query(
            r#"INSERT INTO comms_channel_participants (channel_id, user_id, role, left_at)
               VALUES ($1, $2, 'member', CASE WHEN $3 THEN now() END)"#,
        )
        .bind(dm)
        .bind(user_id)
        .bind(left)
        .execute(&pool)
        .await?;
    }
    let repo = repo(pool);
    let mut participants = repo
        .get_direct_message_participants(&dm)
        .await?
        .expect("a direct message");
    participants.sort();
    let mut expected = vec![
        USER_A.to_string(),
        USER_B.to_string(),
        "bot-123".to_string(),
    ];
    expected.sort();
    assert_eq!(participants, expected);
    // The fixture's channels are public.
    assert_eq!(
        repo.get_direct_message_participants(&Uuid::from_u128(0xc01))
            .await?,
        None
    );
    assert_eq!(
        repo.get_direct_message_participants(&Uuid::now_v7())
            .await?,
        None
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn refusals_hold_only_until_the_one_on_one_is_decided(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let refused = vec![USER_B.to_string()];
    let refusals = |repo: &super::super::PgCallRepo| {
        let repo = repo.clone();
        async move {
            Ok::<_, anyhow::Error>(
                repo.get_call_record_by_call_id(&CALL1)
                    .await?
                    .expect("live call")
                    .one_on_one_recording_refused_by,
            )
        }
    };
    assert!(refusals(&repo).await?.is_empty());
    assert!(repo.record_one_on_one_refusals(&CALL1, &refused).await?);
    assert_eq!(refusals(&repo).await?, refused);

    // A third person ends the one-on-one, and with it the refusal.
    repo.add_participant(&CALL1, USER_C.deref().copied())
        .await?;
    assert!(repo.mark_call_more_than_two(&CALL1).await?.is_some());
    assert!(refusals(&repo).await?.is_empty());
    assert!(!repo.record_one_on_one_refusals(&CALL1, &refused).await?);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn a_transcribing_call_takes_no_refusals(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    assert!(repo.claim_meeting_transcriber(&CALL1).await?);
    assert!(!repo.claim_meeting_transcriber(&CALL1).await?);
    assert!(!repo.claim_meeting_transcriber(&Uuid::now_v7()).await?);
    assert!(
        !repo
            .record_one_on_one_refusals(&CALL1, &[USER_B.to_string()])
            .await?
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn everyone_who_joined_counts_as_a_participant(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    repo.remove_participant(&CALL1, USER_B.deref().copied())
        .await?;
    assert_eq!(
        repo.get_meeting_participant_ids(&CALL1).await?,
        vec![USER_A.to_string(), USER_B.to_string()]
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn blocking_huddle_sharing_unshares_the_teams_live_huddles(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    user_a_on_a_team(&pool).await?;
    let repo = repo(pool);
    let other = Uuid::now_v7();
    repo.create_call(
        &other,
        &Uuid::from_u128(0xc02),
        &other.to_string(),
        USER_B.deref().copied(),
    )
    .await?
    .expect("created");
    let shared = |call_id: Uuid| {
        let repo = repo.clone();
        async move {
            Ok::<_, anyhow::Error>(
                repo.get_call_record_by_call_id(&call_id)
                    .await?
                    .expect("live call")
                    .share_with_team,
            )
        }
    };
    assert!(shared(CALL1).await?);
    assert!(shared(other).await?);
    repo.unshare_live_team_huddles(&TEAM_ID).await?;
    // Only huddles hosted by the team's members are unshared.
    assert!(!shared(CALL1).await?);
    assert!(shared(other).await?);
    Ok(())
}

fn attendance(more_than_two: bool, external: bool) -> Option<MeetingAttendance> {
    Some(MeetingAttendance {
        more_than_two,
        external,
    })
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn a_call_turns_external_once_and_reports_its_recorder(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    assert_eq!(
        repo.get_meeting_attendance(&CALL1).await?,
        attendance(false, false)
    );
    repo.set_egress_id(&CALL1, "egress-1").await?;

    assert_eq!(
        repo.mark_call_external(&CALL1).await?,
        Some(MeetingKindChange {
            egress_id: Some("egress-1".to_string()),
        })
    );
    assert_eq!(
        repo.get_meeting_attendance(&CALL1).await?,
        attendance(false, true)
    );
    assert_eq!(repo.mark_call_external(&CALL1).await?, None);

    // A call that is no longer live is neither flagged nor flaggable.
    let ended = Uuid::now_v7();
    assert_eq!(repo.mark_call_external(&ended).await?, None);
    assert_eq!(repo.get_meeting_attendance(&ended).await?, None);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn a_third_person_ends_the_one_on_one_once(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    repo.set_egress_id(&CALL1, "egress-1").await?;
    // The fixture call has two participants.
    assert_eq!(repo.mark_call_more_than_two(&CALL1).await?, None);

    // Leaving and rejoining is still the same two people.
    repo.remove_participant(&CALL1, USER_B.deref().copied())
        .await?;
    repo.add_participant(&CALL1, USER_B.deref().copied())
        .await?;
    assert_eq!(repo.mark_call_more_than_two(&CALL1).await?, None);

    // A third person counts even after someone else has left.
    repo.remove_participant(&CALL1, USER_B.deref().copied())
        .await?;
    repo.add_participant(&CALL1, USER_C.deref().copied())
        .await?;
    assert_eq!(
        repo.mark_call_more_than_two(&CALL1).await?,
        Some(MeetingKindChange {
            egress_id: Some("egress-1".to_string()),
        })
    );
    assert_eq!(
        repo.get_meeting_attendance(&CALL1).await?,
        attendance(true, false)
    );
    assert_eq!(repo.mark_call_more_than_two(&CALL1).await?, None);

    // A later outsider still turns the call external.
    assert!(repo.mark_call_external(&CALL1).await?.is_some());
    assert_eq!(
        repo.get_meeting_attendance(&CALL1).await?,
        attendance(true, true)
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn an_external_call_never_becomes_an_internal_one(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    assert!(repo.mark_call_external(&CALL1).await?.is_some());
    repo.add_participant(&CALL1, USER_C.deref().copied())
        .await?;
    assert_eq!(repo.mark_call_more_than_two(&CALL1).await?, None);
    assert_eq!(
        repo.get_meeting_attendance(&CALL1).await?,
        attendance(false, true)
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn a_call_claims_its_recorder_once(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    assert!(repo.claim_meeting_recorder(&CALL1).await?);
    assert!(!repo.claim_meeting_recorder(&CALL1).await?);
    assert!(!repo.claim_meeting_recorder(&Uuid::now_v7()).await?);
    Ok(())
}
