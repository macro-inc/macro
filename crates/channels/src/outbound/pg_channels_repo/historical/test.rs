use super::*;
use crate::domain::{
    models::{
        GetChannelsRequest, GetOrCreateAction, GetOrCreateDmRequest, ParticipantRole, Sender,
    },
    ports::{ChannelListRepo, ChannelRepo, ChannelService},
    service::ChannelServiceImpl,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_pagination::{Query, SimpleSortMethod};
use sqlx::PgPool;
use std::collections::HashSet;

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{email}")).unwrap()
}

fn timestamp(seconds: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(seconds, 0).unwrap()
}

fn pair() -> DmPair {
    DmPair::new(user("a@example.com"), user("b@example.com")).unwrap()
}

fn historical_dm(id: Uuid) -> DmCreation {
    DmCreation::Historical {
        id,
        created_at: timestamp(1_000),
    }
}

fn channel() -> HistoricalChannel {
    HistoricalChannel {
        id: macro_uuid::generate_uuid_v7(),
        name: "source name".into(),
        kind: HistoricalChannelKind::Private,
        owner: user("admin@example.com"),
        participants: HashSet::from([user("a@example.com"), user("b@example.com")]),
        created_at: timestamp(1_000),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn historical_replay_preserves_settings_roles_leavers_and_live_activity(pool: PgPool) {
    let repo = PgChannelsRepo::new(pool.clone());
    let mut request = channel();
    assert!(
        repo.create_historical_channel(&request)
            .await
            .unwrap()
            .created
    );
    sqlx::query!(
        "UPDATE comms_channel_participants SET role = 'admin', left_at = $2 WHERE channel_id = $1 AND user_id = 'macro|a@example.com'",
        request.id, timestamp(2_000),
    ).execute(&pool).await.unwrap();
    repo.advance_historical_activity(request.id, timestamp(4_000))
        .await
        .unwrap();
    request.name = "do not rename".into();
    request.owner = user("another-admin@example.com");
    request.created_at = timestamp(500);
    assert!(
        !repo
            .create_historical_channel(&request)
            .await
            .unwrap()
            .created
    );
    let members = vec![
        user("admin@example.com"),
        user("a@example.com"),
        user("c@example.com"),
    ];
    repo.insert_historical_participants(request.id, &members, timestamp(500))
        .await
        .unwrap();
    repo.insert_historical_participants(request.id, &members, timestamp(600))
        .await
        .unwrap();
    repo.advance_historical_activity(request.id, timestamp(3_000))
        .await
        .unwrap();

    let row = sqlx::query!(
        "SELECT name, owner_id, team_id, auto_join_team, created_at, updated_at FROM comms_channels WHERE id = $1",
        request.id,
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(row.name.as_deref(), Some("source name"));
    assert_eq!(row.owner_id, "macro|admin@example.com");
    assert_eq!(row.team_id, None);
    assert!(!row.auto_join_team);
    assert_eq!(row.created_at, timestamp(1_000));
    assert_eq!(row.updated_at, timestamp(4_000));
    let members = sqlx::query!(
        r#"SELECT user_id, role AS "role: ParticipantRole", joined_at, left_at
           FROM comms_channel_participants WHERE channel_id = $1 ORDER BY user_id"#,
        request.id,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(members.len(), 4);
    let leaver = members
        .iter()
        .find(|p| p.user_id == "macro|a@example.com")
        .unwrap();
    assert_eq!(leaver.role, ParticipantRole::Admin);
    assert_eq!(leaver.joined_at, timestamp(1_000));
    assert_eq!(leaver.left_at, Some(timestamp(2_000)));
    let owner = members
        .iter()
        .find(|p| p.user_id == "macro|admin@example.com")
        .unwrap();
    assert_eq!(owner.role, ParticipantRole::Owner);
    assert_eq!(owner.joined_at, timestamp(1_000));
    assert_eq!(owner.left_at, None);
    let added = members
        .iter()
        .find(|p| p.user_id == "macro|c@example.com")
        .unwrap();
    assert_eq!(added.joined_at, timestamp(500));
    assert_eq!(
        sqlx::query_scalar!("SELECT COUNT(*) FROM comms_activity")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_live_and_import_dm_creation_share_one_channel(pool: PgPool) {
    let repo = PgChannelsRepo::new(pool.clone());
    let service = ChannelServiceImpl::new(repo.clone());
    let mut calls = Vec::new();
    for index in 0..20 {
        let repo = repo.clone();
        let service = service.clone();
        calls.push(tokio::spawn(async move {
            if index % 2 == 0 {
                repo.ensure_dm(pair(), historical_dm(macro_uuid::generate_uuid_v7()))
                    .await
                    .unwrap()
            } else {
                let response = service
                    .get_or_create_dm(
                        Sender::new_from_user(pair().hi().clone()),
                        GetOrCreateDmRequest {
                            recipient_id: pair().lo().clone(),
                        },
                    )
                    .await
                    .unwrap();
                EnsuredChannel {
                    id: response.channel_id.parse().unwrap(),
                    created: response.action == GetOrCreateAction::Create,
                }
            }
        }));
    }
    let mut ids = HashSet::new();
    let mut created = 0;
    for call in calls {
        let result = call.await.unwrap();
        ids.insert(result.id);
        created += usize::from(result.created);
    }
    assert_eq!(ids.len(), 1);
    assert_eq!(created, 1);
    let id = *ids.iter().next().unwrap();
    let participants = repo.get_channel_participants(id).await.unwrap();
    assert_eq!(participants.len(), 2);
    assert_eq!(
        participants
            .iter()
            .filter(|p| p.role == ParticipantRole::Owner)
            .count(),
        1
    );
    assert_eq!(
        sqlx::query_scalar!(r#"SELECT COUNT(*) FROM "User""#)
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn malformed_dm_is_not_reused_and_exact_duplicates_choose_oldest_then_id(pool: PgPool) {
    let repo = PgChannelsRepo::new(pool.clone());
    let malformed = repo
        .ensure_dm(pair(), historical_dm(macro_uuid::generate_uuid_v7()))
        .await
        .unwrap();
    // Legacy corruption includes even a departed third member.
    sqlx::query!(
        "INSERT INTO comms_channel_participants (channel_id, user_id, role, left_at) VALUES ($1, 'macro|third@example.com', 'member', NOW())",
        malformed.id,
    ).execute(&pool).await.unwrap();
    let exact = repo
        .ensure_dm(pair(), historical_dm(macro_uuid::generate_uuid_v7()))
        .await
        .unwrap();
    assert!(exact.created);
    assert_ne!(malformed.id, exact.id);
    assert!(
        repo.insert_historical_participants(
            exact.id,
            &[user("third@example.com")],
            timestamp(1_000)
        )
        .await
        .is_err()
    );

    // Simulate pre-lock duplicate DMs, including a historical leaver.
    let duplicate_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO comms_channels (id, owner_id, channel_type, created_at) VALUES ($1, 'macro|a@example.com', 'direct_message', $2)",
        duplicate_id, timestamp(1_000),
    ).execute(&pool).await.unwrap();
    sqlx::query!(
        "INSERT INTO comms_channel_participants (channel_id, user_id, role, joined_at, left_at) SELECT $1, user_id, role, joined_at, $3 FROM comms_channel_participants WHERE channel_id = $2",
        duplicate_id, exact.id, timestamp(2_000),
    ).execute(&pool).await.unwrap();
    let expected = exact.id.min(duplicate_id);
    assert_eq!(
        repo.ensure_dm(pair(), DmCreation::Live(pair().hi().clone()))
            .await
            .unwrap(),
        EnsuredChannel {
            id: expected,
            created: false
        }
    );
    assert_eq!(
        repo.maybe_get_dm(pair().hi().clone(), pair().lo().clone())
            .await
            .unwrap(),
        Some(expected)
    );
    sqlx::query!(
        "UPDATE comms_channels SET created_at = $2 WHERE id = $1",
        duplicate_id,
        timestamp(900)
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        repo.ensure_dm(pair(), historical_dm(macro_uuid::generate_uuid_v7()))
            .await
            .unwrap()
            .id,
        duplicate_id
    );
    let left_count = sqlx::query_scalar!("SELECT COUNT(*) FROM comms_channel_participants WHERE channel_id = $1 AND left_at IS NOT NULL", duplicate_id).fetch_one(&pool).await.unwrap();
    assert_eq!(left_count, Some(2));
    assert_eq!(
        sqlx::query_scalar!("SELECT COUNT(*) FROM comms_activity")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn importing_a_live_dm_preserves_owner_and_creates_no_additional_activity(pool: PgPool) {
    let repo = PgChannelsRepo::new(pool.clone());
    let live = repo
        .ensure_dm(pair(), DmCreation::Live(pair().hi().clone()))
        .await
        .unwrap();
    let before = repo.get_channel_participants(live.id).await.unwrap();
    let imported = repo
        .ensure_dm(pair(), historical_dm(macro_uuid::generate_uuid_v7()))
        .await
        .unwrap();
    assert_eq!(
        imported,
        EnsuredChannel {
            id: live.id,
            created: false
        }
    );
    let after = repo.get_channel_participants(live.id).await.unwrap();
    for original in before {
        let member = after
            .iter()
            .find(|p| p.user_id == original.user_id)
            .unwrap();
        assert_eq!(member.role, original.role);
        assert_eq!(member.joined_at, original.joined_at);
    }
    assert_eq!(
        after
            .iter()
            .find(|p| p.role == ParticipantRole::Owner)
            .unwrap()
            .user_id,
        pair().hi().as_ref()
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT COUNT(*) FROM comms_activity")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(1)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn dm_rejects_outsider_owner_and_conflicting_reservation(pool: PgPool) {
    let repo = PgChannelsRepo::new(pool.clone());
    assert!(
        repo.ensure_dm(pair(), DmCreation::Live(user("admin@example.com")))
            .await
            .is_err()
    );
    let request = channel();
    repo.create_historical_channel(&request).await.unwrap();
    assert!(
        repo.ensure_dm(pair(), historical_dm(request.id))
            .await
            .is_err()
    );
    let count = sqlx::query_scalar!("SELECT COUNT(*) FROM comms_channels")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, Some(1));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn historical_dm_preserves_live_timestamps_and_activity_update_rolls_back(pool: PgPool) {
    let repo = PgChannelsRepo::new(pool.clone());
    let id = macro_uuid::generate_uuid_v7();
    assert_eq!(
        repo.ensure_dm(pair(), historical_dm(id)).await.unwrap(),
        EnsuredChannel { id, created: true }
    );
    let initial = sqlx::query!(
        "SELECT owner_id, created_at, updated_at, team_id FROM comms_channels WHERE id = $1",
        id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(initial.owner_id, pair().lo().as_ref());
    assert_eq!(initial.team_id, None);
    assert_eq!(initial.created_at, timestamp(1_000));
    assert_eq!(initial.updated_at, timestamp(1_000));
    assert!(
        repo.get_channel_participants(id)
            .await
            .unwrap()
            .iter()
            .all(|p| p.joined_at == timestamp(1_000))
    );

    let mut tx = pool.begin().await.unwrap();
    advance_historical_activity(&mut tx, id, timestamp(2_000))
        .await
        .unwrap();
    tx.rollback().await.unwrap();
    let rolled_back =
        sqlx::query_scalar!("SELECT updated_at FROM comms_channels WHERE id = $1", id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(rolled_back, timestamp(1_000));

    repo.touch_channel_updated_at(id).await.unwrap();
    let live_at = sqlx::query_scalar!("SELECT updated_at FROM comms_channels WHERE id = $1", id)
        .fetch_one(&pool)
        .await
        .unwrap();
    repo.advance_historical_activity(id, timestamp(2_000))
        .await
        .unwrap();
    assert!(
        !repo
            .ensure_dm(pair(), historical_dm(macro_uuid::generate_uuid_v7()))
            .await
            .unwrap()
            .created
    );
    let after = sqlx::query_scalar!("SELECT updated_at FROM comms_channels WHERE id = $1", id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(after, live_at);
    assert_eq!(
        sqlx::query_scalar!("SELECT COUNT(*) FROM comms_activity")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_includes_unregistered_memberships_without_activity(pool: PgPool) {
    let repo = PgChannelsRepo::new(pool);
    let request = channel();
    repo.create_historical_channel(&request).await.unwrap();
    let params = GetChannelsRequest {
        macro_id: user("a@example.com"),
        limit: Some(10),
        include_frecency: false,
        query: Query::Sort(SimpleSortMethod::UpdatedAt, None),
    }
    .into_params();
    let channels = repo
        .get_user_channels_with_participants(params)
        .await
        .unwrap();
    assert_eq!(channels.len(), 1);
    assert_eq!(channels[0].channel.id, request.id);
    assert_eq!(channels[0].participants.len(), 3);
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn team_creation_is_explicit_and_reuse_preserves_auto_join(pool: PgPool) {
    let repo = PgChannelsRepo::new(pool.clone());
    let mut request = channel();
    request.kind =
        HistoricalChannelKind::Team(Uuid::from_u128(0x11111111_1111_1111_1111_111111111111));
    let (first, second) = tokio::join!(
        repo.create_historical_channel(&request),
        repo.create_historical_channel(&request)
    );
    assert_ne!(first.unwrap().created, second.unwrap().created);
    let participants = repo.get_channel_participants(request.id).await.unwrap();
    assert_eq!(participants.len(), 3);
    assert_eq!(
        participants
            .iter()
            .find(|p| p.role == ParticipantRole::Owner)
            .unwrap()
            .user_id,
        request.owner.as_ref()
    );
    let auto_join = sqlx::query_scalar!(
        "SELECT auto_join_team FROM comms_channels WHERE id = $1",
        request.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!auto_join);
    sqlx::query!(
        "UPDATE comms_channels SET auto_join_team = true WHERE id = $1",
        request.id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        !repo
            .create_historical_channel(&request)
            .await
            .unwrap()
            .created
    );
    assert!(
        sqlx::query_scalar!(
            "SELECT auto_join_team FROM comms_channels WHERE id = $1",
            request.id
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    );
    request.kind = HistoricalChannelKind::Private;
    assert!(repo.create_historical_channel(&request).await.is_err());
}
