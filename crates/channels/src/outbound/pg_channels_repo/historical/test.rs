use super::*;
use crate::domain::{
    events::ChannelEvent,
    ports::{ChannelEventDispatcher, ChannelMutationErr},
    service::NoopChannelReferenceSharePermissions,
};
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
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};

#[derive(Clone, Default)]
struct CreationEvents(Arc<Mutex<Vec<Uuid>>>);

impl ChannelEventDispatcher for CreationEvents {
    fn dispatch(&self, event: ChannelEvent) {
        let ChannelEvent::ChannelCreated { channel_id, .. } = event else {
            panic!("unexpected event");
        };
        self.0.lock().unwrap().push(channel_id);
    }
}

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
                            recipient_id: Sender::new_from_user(pair().lo().clone()),
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

/// An import never reuses a DM with a third member's row, even one who left;
/// live lookups take a DM both people are in whose third member left as the
/// pair's, as every channel list shows it. Of exact duplicates, an import takes the oldest,
/// then the lowest id, and live lookups the one both people are still in.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn malformed_and_duplicate_dms_are_chosen_by_their_rule(pool: PgPool) {
    let repo = PgChannelsRepo::new(pool.clone());
    let malformed = repo
        .ensure_dm(pair(), historical_dm(macro_uuid::generate_uuid_v7()))
        .await
        .unwrap();
    // A departed third member: legacy corruption to an import, gone to live lookups.
    sqlx::query!(
        "INSERT INTO comms_channel_participants (channel_id, user_id, role, left_at) VALUES ($1, 'macro|third@example.com', 'member', NOW())",
        malformed.id,
    ).execute(&pool).await.unwrap();
    // Newer than the exact DM, until the end.
    sqlx::query!(
        "UPDATE comms_channels SET created_at = $2 WHERE id = $1",
        malformed.id,
        timestamp(1_100)
    )
    .execute(&pool)
    .await
    .unwrap();
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
    // An import takes the oldest, then the lowest id. Live get-or-create and
    // the lookup take the DM both people are still in: the duplicate they
    // left is one neither can open.
    assert_eq!(
        repo.ensure_dm(pair(), historical_dm(macro_uuid::generate_uuid_v7()))
            .await
            .unwrap()
            .id,
        exact.id.min(duplicate_id)
    );
    let live_answers = |repo: PgChannelsRepo| async move {
        (
            repo.ensure_dm(pair(), DmCreation::Live(pair().hi().clone()))
                .await
                .unwrap(),
            repo.maybe_get_dm(pair().hi().clone(), pair().lo().clone())
                .await
                .unwrap(),
            repo.maybe_get_dm(pair().lo().clone(), pair().hi().clone())
                .await
                .unwrap(),
        )
    };
    let in_exact = (
        EnsuredChannel {
            id: exact.id,
            created: false,
        },
        Some(exact.id),
        Some(exact.id),
    );
    assert_eq!(live_answers(repo.clone()).await, in_exact);
    sqlx::query!(
        "UPDATE comms_channels SET created_at = $2 WHERE id = $1",
        duplicate_id,
        timestamp(900)
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        live_answers(repo.clone()).await,
        in_exact,
        "an older DM both people left never takes over the one they are in"
    );
    assert_eq!(
        repo.ensure_dm(pair(), historical_dm(macro_uuid::generate_uuid_v7()))
            .await
            .unwrap()
            .id,
        duplicate_id
    );
    let left_count = sqlx::query_scalar!("SELECT COUNT(*) FROM comms_channel_participants WHERE channel_id = $1 AND left_at IS NOT NULL", duplicate_id).fetch_one(&pool).await.unwrap();
    assert_eq!(left_count, Some(2));

    sqlx::query!(
        "UPDATE comms_channels SET created_at = $2 WHERE id = $1",
        malformed.id,
        timestamp(800)
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        live_answers(repo.clone()).await,
        (
            EnsuredChannel {
                id: malformed.id,
                created: false,
            },
            Some(malformed.id),
            Some(malformed.id),
        ),
        "the oldest DM both are in, its third member gone"
    );
    assert_eq!(
        repo.ensure_dm(pair(), historical_dm(macro_uuid::generate_uuid_v7()))
            .await
            .unwrap()
            .id,
        duplicate_id,
        "an import still skips the DM with a third member's row"
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT COUNT(*) FROM comms_activity")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
}

/// A bot added to a DM and removed again leaves the DM the pair's while both
/// are in it: every channel list shows it with the two people only, so
/// get-or-create and the lookup keep answering it. A bot still in the DM makes it a group. An import
/// keeps the stored roster, so it still maps the pair's conversation onto a
/// channel of its own, as it did before.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_removed_bot_leaves_the_dm_the_pairs(pool: PgPool) {
    let repo = PgChannelsRepo::new(pool.clone());
    let dm = repo
        .ensure_dm(pair(), DmCreation::Live(pair().lo().clone()))
        .await
        .unwrap();
    let bot = format!("bot|{}", macro_uuid::generate_uuid_v7());
    sqlx::query!(
        "INSERT INTO comms_channel_participants (channel_id, user_id, role) VALUES ($1, $2, 'member')",
        dm.id,
        bot,
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        repo.maybe_get_dm(pair().lo().clone(), pair().hi().clone())
            .await
            .unwrap(),
        None,
        "a bot in the DM makes it a group"
    );

    sqlx::query!(
        "UPDATE comms_channel_participants SET left_at = NOW() WHERE channel_id = $1 AND user_id = $2",
        dm.id,
        bot,
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        repo.maybe_get_dm(pair().hi().clone(), pair().lo().clone())
            .await
            .unwrap(),
        Some(dm.id)
    );
    assert_eq!(
        repo.ensure_dm(pair(), DmCreation::Live(pair().hi().clone()))
            .await
            .unwrap(),
        EnsuredChannel {
            id: dm.id,
            created: false
        }
    );

    let mut connection = pool.acquire().await.unwrap();
    assert_eq!(
        find_dm(&mut connection, &pair(), DmRoster::Stored)
            .await
            .unwrap(),
        None,
        "an import's lookup still counts the removed bot"
    );
    drop(connection);
    let reserved = macro_uuid::generate_uuid_v7();
    assert_eq!(
        repo.ensure_dm(pair(), historical_dm(reserved))
            .await
            .unwrap(),
        EnsuredChannel {
            id: reserved,
            created: true
        }
    );
}

/// The lookup answers a viewer only a DM they are still in, the only kind
/// they can open, as the joined channel list it replaced did; the other
/// person still finds it, and get-or-create still reuses it. Of several DMs,
/// get-or-create and the lookup take the one both people are in.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_lookup_answers_a_dm_the_viewer_is_still_in(pool: PgPool) {
    let repo = PgChannelsRepo::new(pool.clone());
    let (lo, hi) = (
        pair().lo().as_ref().to_owned(),
        pair().hi().as_ref().to_owned(),
    );
    let left = repo
        .ensure_dm(pair(), DmCreation::Live(pair().lo().clone()))
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE comms_channel_participants SET left_at = NOW() WHERE channel_id = $1 AND user_id = $2",
        left.id,
        lo,
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        repo.maybe_get_dm(pair().lo().clone(), pair().hi().clone())
            .await
            .unwrap(),
        None,
        "the viewer left it"
    );
    assert_eq!(
        repo.maybe_get_dm(pair().hi().clone(), pair().lo().clone())
            .await
            .unwrap(),
        Some(left.id)
    );
    assert_eq!(
        repo.ensure_dm(pair(), DmCreation::Live(pair().lo().clone()))
            .await
            .unwrap(),
        EnsuredChannel {
            id: left.id,
            created: false
        }
    );

    // A newer DM both people are in, beside the older one.
    let joined = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO comms_channels (id, owner_id, channel_type, created_at) VALUES ($1, 'macro|a@example.com', 'direct_message', $2)",
        joined,
        chrono::Utc::now() + chrono::Duration::hours(1),
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO comms_channel_participants (channel_id, user_id, role) VALUES ($1, $2, 'member'), ($1, $3, 'member')",
        joined,
        lo,
        hi,
    )
    .execute(&pool)
    .await
    .unwrap();
    for (viewer, other) in [
        (pair().lo().clone(), pair().hi().clone()),
        (pair().hi().clone(), pair().lo().clone()),
    ] {
        assert_eq!(
            repo.maybe_get_dm(viewer.clone(), other).await.unwrap(),
            Some(joined)
        );
        assert_eq!(
            repo.ensure_dm(pair(), DmCreation::Live(viewer))
                .await
                .unwrap(),
            EnsuredChannel {
                id: joined,
                created: false
            }
        );
    }
}

/// When each person has left one of two DMs, each lands in the one they can
/// still write in, by get-or-create and by the lookup alike, whichever is
/// older.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn each_person_reuses_a_dm_they_are_still_in(pool: PgPool) {
    let repo = PgChannelsRepo::new(pool.clone());
    let (lo, hi) = (
        pair().lo().as_ref().to_owned(),
        pair().hi().as_ref().to_owned(),
    );
    let mut dms = Vec::new();
    for (seconds, gone) in [(1_000, &lo), (2_000, &hi)] {
        let id = macro_uuid::generate_uuid_v7();
        sqlx::query!(
            "INSERT INTO comms_channels (id, owner_id, channel_type, created_at) VALUES ($1, 'macro|a@example.com', 'direct_message', $2)",
            id,
            timestamp(seconds),
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query!(
            "INSERT INTO comms_channel_participants (channel_id, user_id, role) VALUES ($1, $2, 'member'), ($1, $3, 'member')",
            id,
            lo,
            hi,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query!(
            "UPDATE comms_channel_participants SET left_at = NOW() WHERE channel_id = $1 AND user_id = $2",
            id,
            gone,
        )
        .execute(&pool)
        .await
        .unwrap();
        dms.push(id);
    }
    // The older DM is the one `lo` left; the newer, the one `hi` left.
    let (lo_left, hi_left) = (dms[0], dms[1]);
    for (viewer, other, theirs) in [
        (pair().lo().clone(), pair().hi().clone(), hi_left),
        (pair().hi().clone(), pair().lo().clone(), lo_left),
    ] {
        assert_eq!(
            repo.maybe_get_dm(viewer.clone(), other).await.unwrap(),
            Some(theirs)
        );
        assert_eq!(
            repo.ensure_dm(pair(), DmCreation::Live(viewer))
                .await
                .unwrap(),
            EnsuredChannel {
                id: theirs,
                created: false
            }
        );
    }
}

async fn insert_dm(pool: &PgPool, seconds: i64, rows: &[(&str, bool)]) -> Uuid {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO comms_channels (id, owner_id, channel_type, created_at) VALUES ($1, 'macro|a@example.com', 'direct_message', $2)",
        id,
        timestamp(seconds),
    )
    .execute(pool)
    .await
    .unwrap();
    for (user_id, left) in rows {
        sqlx::query!(
            "INSERT INTO comms_channel_participants (channel_id, user_id, role, left_at) VALUES ($1, $2, 'member', CASE WHEN $3 THEN NOW() END)",
            id,
            *user_id,
            *left,
        )
        .execute(pool)
        .await
        .unwrap();
    }
    id
}

/// A legacy group conversation is the pair's DM while both people are still
/// in it, its departed third member gone, as channel lists show it. Once the
/// other person has left too, it is not: no list showed it as theirs and
/// get-or-create never reused it, so the lookup answers nothing and a first
/// message starts a DM of their own.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_group_the_other_person_left_is_not_their_dm(pool: PgPool) {
    let repo = PgChannelsRepo::new(pool.clone());
    let (lo, hi) = (
        pair().lo().as_ref().to_owned(),
        pair().hi().as_ref().to_owned(),
    );
    let group = insert_dm(
        &pool,
        1_000,
        &[
            (&lo, false),
            (&hi, false),
            ("macro|third@example.com", true),
        ],
    )
    .await;
    for (viewer, other) in [
        (pair().lo().clone(), pair().hi().clone()),
        (pair().hi().clone(), pair().lo().clone()),
    ] {
        assert_eq!(repo.maybe_get_dm(viewer, other).await.unwrap(), Some(group));
    }

    sqlx::query!(
        "UPDATE comms_channel_participants SET left_at = NOW() WHERE channel_id = $1 AND user_id = $2",
        group,
        hi,
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        repo.maybe_get_dm(pair().lo().clone(), pair().hi().clone())
            .await
            .unwrap(),
        None,
        "the other person and a third left: a group, not their DM"
    );
    let created = repo
        .ensure_dm(pair(), DmCreation::Live(pair().lo().clone()))
        .await
        .unwrap();
    assert!(created.created);
    assert_ne!(created.id, group);
    for (viewer, other) in [
        (pair().lo().clone(), pair().hi().clone()),
        (pair().hi().clone(), pair().lo().clone()),
    ] {
        assert_eq!(
            repo.maybe_get_dm(viewer, other).await.unwrap(),
            Some(created.id)
        );
    }
}

/// A removed bot's row counts like a departed person's: overlooked while
/// both people are in the DM, counted once either has left. Get-or-create
/// rejoins nobody, so reusing that DM would put a first message where its
/// sender cannot post, or where the other person never sees it; as before,
/// it starts a DM they are both in.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_dm_one_person_left_counts_its_removed_bot(pool: PgPool) {
    let repo = PgChannelsRepo::new(pool.clone());
    let (lo, hi) = (
        pair().lo().as_ref().to_owned(),
        pair().hi().as_ref().to_owned(),
    );
    let bot = format!("bot|{}", macro_uuid::generate_uuid_v7());
    let lo_left = insert_dm(&pool, 1_000, &[(&lo, true), (&hi, false), (&bot, true)]).await;
    let mut connection = pool.acquire().await.unwrap();
    for actor in [pair().lo(), pair().hi()] {
        assert_eq!(
            find_dm(&mut connection, &pair(), DmRoster::Listed(actor))
                .await
                .unwrap(),
            None,
            "neither the one who left nor the one still in reuses it"
        );
    }
    drop(connection);
    for (viewer, other) in [
        (pair().lo().clone(), pair().hi().clone()),
        (pair().hi().clone(), pair().lo().clone()),
    ] {
        assert_eq!(repo.maybe_get_dm(viewer, other).await.unwrap(), None);
    }

    let created = repo
        .ensure_dm(pair(), DmCreation::Live(pair().lo().clone()))
        .await
        .unwrap();
    assert!(created.created);
    assert_ne!(created.id, lo_left);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM comms_channel_participants WHERE channel_id = $1 AND left_at IS NULL",
            created.id,
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(2),
        "both people are in the new DM"
    );
}

/// A third member still in the channel, a person or a bot, makes it a group
/// even once one of the pair has left: two people are still in it, but not
/// these two, so it is nobody's DM with the one who left.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_third_member_still_in_keeps_a_group_after_one_left(pool: PgPool) {
    let repo = PgChannelsRepo::new(pool.clone());
    let (lo, hi) = (
        pair().lo().as_ref().to_owned(),
        pair().hi().as_ref().to_owned(),
    );
    let bot = format!("bot|{}", macro_uuid::generate_uuid_v7());
    for third in ["macro|third@example.com", bot.as_str()] {
        let group = insert_dm(&pool, 1_000, &[(&lo, false), (&hi, true), (third, false)]).await;
        let mut connection = pool.acquire().await.unwrap();
        for actor in [pair().lo(), pair().hi()] {
            assert_eq!(
                find_dm(&mut connection, &pair(), DmRoster::Listed(actor))
                    .await
                    .unwrap(),
                None,
                "{third} is still in it: a group"
            );
        }
        drop(connection);
        assert_eq!(
            repo.maybe_get_dm(pair().lo().clone(), pair().hi().clone())
                .await
                .unwrap(),
            None,
            "{third} is still in it: a group"
        );
        sqlx::query!(
            "DELETE FROM comms_channel_participants WHERE channel_id = $1",
            group
        )
        .execute(&pool)
        .await
        .unwrap();
    }
}

/// Of two DMs both people are in, created within one second, the lookup and
/// get-or-create take the one created first, by instant: one made on the
/// second comes before one made half a second later, though its time
/// serialized as RFC 3339 (`…:40Z`) sorts after the other's (`…:40.500Z`)
/// as text. The younger has the lower id, so no tie-break picks the older.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_older_of_two_dms_within_a_second_wins_by_instant(pool: PgPool) {
    let repo = PgChannelsRepo::new(pool.clone());
    let (lo, hi) = (
        pair().lo().as_ref().to_owned(),
        pair().hi().as_ref().to_owned(),
    );
    let younger = insert_dm(&pool, 1_000, &[(&lo, false), (&hi, false)]).await;
    sqlx::query!(
        "UPDATE comms_channels SET created_at = created_at + interval '500 milliseconds' WHERE id = $1",
        younger
    )
    .execute(&pool)
    .await
    .unwrap();
    let older = insert_dm(&pool, 1_000, &[(&lo, false), (&hi, false)]).await;
    assert!(younger < older, "the younger DM has the lower id");
    for (viewer, other) in [
        (pair().lo().clone(), pair().hi().clone()),
        (pair().hi().clone(), pair().lo().clone()),
    ] {
        assert_eq!(
            repo.maybe_get_dm(viewer.clone(), other).await.unwrap(),
            Some(older)
        );
        assert_eq!(
            repo.ensure_dm(pair(), DmCreation::Live(viewer))
                .await
                .unwrap(),
            EnsuredChannel {
                id: older,
                created: false
            }
        );
    }
}

/// Live get-or-create ranks a DM its actor left before one both people left,
/// however much older that one is, and DMs of the same rank created at the
/// same instant by id; an import keeps taking the oldest of every row.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn live_ranks_by_who_left_then_age_then_id(pool: PgPool) {
    let repo = PgChannelsRepo::new(pool.clone());
    let (lo, hi) = (
        pair().lo().as_ref().to_owned(),
        pair().hi().as_ref().to_owned(),
    );
    let both_left = insert_dm(&pool, 1_000, &[(&lo, true), (&hi, true)]).await;
    assert_eq!(
        repo.ensure_dm(pair(), DmCreation::Live(pair().lo().clone()))
            .await
            .unwrap(),
        EnsuredChannel {
            id: both_left,
            created: false
        },
        "a DM both left is still theirs when it is the only one"
    );
    let lo_left = insert_dm(&pool, 2_000, &[(&lo, true), (&hi, false)]).await;
    assert_eq!(
        repo.ensure_dm(pair(), DmCreation::Live(pair().lo().clone()))
            .await
            .unwrap(),
        EnsuredChannel {
            id: lo_left,
            created: false
        },
        "the actor left it, but not both"
    );
    assert_eq!(
        repo.maybe_get_dm(pair().lo().clone(), pair().hi().clone())
            .await
            .unwrap(),
        None,
        "the viewer left both"
    );
    assert_eq!(
        repo.maybe_get_dm(pair().hi().clone(), pair().lo().clone())
            .await
            .unwrap(),
        Some(lo_left)
    );
    let mut connection = pool.acquire().await.unwrap();
    assert_eq!(
        find_dm(&mut connection, &pair(), DmRoster::Stored)
            .await
            .unwrap(),
        Some(both_left)
    );
    drop(connection);

    // Two DMs both are in, created at the same instant, inserted highest id
    // first so neither insertion order nor age decides.
    let (first, second) = (
        macro_uuid::generate_uuid_v7(),
        macro_uuid::generate_uuid_v7(),
    );
    for id in [second, first] {
        sqlx::query!(
            "INSERT INTO comms_channels (id, owner_id, channel_type, created_at) VALUES ($1, 'macro|a@example.com', 'direct_message', $2)",
            id,
            timestamp(3_000),
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query!(
            "INSERT INTO comms_channel_participants (channel_id, user_id, role) VALUES ($1, $2, 'member'), ($1, $3, 'member')",
            id,
            lo,
            hi,
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    let lowest = first.min(second);
    for (viewer, other) in [
        (pair().lo().clone(), pair().hi().clone()),
        (pair().hi().clone(), pair().lo().clone()),
    ] {
        assert_eq!(
            repo.maybe_get_dm(viewer.clone(), other).await.unwrap(),
            Some(lowest)
        );
        assert_eq!(
            repo.ensure_dm(pair(), DmCreation::Live(viewer))
                .await
                .unwrap(),
            EnsuredChannel {
                id: lowest,
                created: false
            }
        );
    }
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

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn onboarding_and_archive_share_reserved_target_without_replaying_effects(pool: PgPool) {
    let repo = PgChannelsRepo::new(pool.clone());
    let events = CreationEvents::default();
    let service = ChannelServiceImpl::with_dependencies(
        repo.clone(),
        events.clone(),
        NoopChannelReferenceSharePermissions,
    );
    let team_id = Uuid::from_u128(0x11111111_1111_1111_1111_111111111111);
    for order in 0..3 {
        let before_channels = sqlx::query_scalar!("SELECT COUNT(*) FROM comms_channels")
            .fetch_one(&pool)
            .await
            .unwrap()
            .unwrap();
        let before_activity = sqlx::query_scalar!("SELECT COUNT(*) FROM comms_activity")
            .fetch_one(&pool)
            .await
            .unwrap()
            .unwrap();
        let mut request = channel();
        request.kind = HistoricalChannelKind::Team(team_id);
        request.owner = user("left-user@test.com");
        let onboarding = || {
            service.create_reserved_team_channel(
                request.owner.clone(),
                request.id,
                team_id,
                "onboarding name".into(),
                HashSet::new(),
            )
        };
        let (archive, onboarded) = match order {
            0 => (
                repo.create_historical_channel(&request).await.unwrap(),
                onboarding().await.unwrap(),
            ),
            1 => {
                let onboarded = onboarding().await.unwrap();
                (
                    repo.create_historical_channel(&request).await.unwrap(),
                    onboarded,
                )
            }
            _ => {
                let (archive, onboarded) =
                    tokio::join!(repo.create_historical_channel(&request), onboarding());
                (archive.unwrap(), onboarded.unwrap())
            }
        };
        assert_eq!(archive.id, onboarded.id);
        assert_ne!(archive.created, onboarded.created);
        assert!(!onboarding().await.unwrap().created);
        assert!(
            !repo
                .create_historical_channel(&request)
                .await
                .unwrap()
                .created
        );
        assert_eq!(
            events
                .0
                .lock()
                .unwrap()
                .iter()
                .filter(|id| **id == request.id)
                .count(),
            usize::from(onboarded.created)
        );
        assert_eq!(
            sqlx::query_scalar!("SELECT COUNT(*) FROM comms_channels")
                .fetch_one(&pool)
                .await
                .unwrap(),
            Some(before_channels + 1)
        );
        assert_eq!(
            sqlx::query_scalar!("SELECT COUNT(*) FROM comms_activity")
                .fetch_one(&pool)
                .await
                .unwrap(),
            Some(before_activity + i64::from(onboarded.created))
        );
        let persisted = sqlx::query!(
            "SELECT name, owner_id, team_id, auto_join_team, created_at, updated_at FROM comms_channels WHERE id = $1",
            request.id,
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(persisted.team_id, Some(team_id));
        assert!(!persisted.auto_join_team);
        if archive.created {
            assert_eq!(persisted.name.as_deref(), Some(request.name.as_str()));
            assert_eq!(persisted.created_at, request.created_at);
        } else {
            assert_eq!(persisted.name.as_deref(), Some("onboarding name"));
            assert!(persisted.created_at > request.created_at);
        }
        // Reuse does not grant access to a different team's caller.
        let denied = service
            .create_reserved_team_channel(
                user("user-d@test.com"),
                request.id,
                team_id,
                "forbidden".into(),
                HashSet::new(),
            )
            .await;
        assert!(matches!(denied, Err(ChannelMutationErr::Unauthorized(_))));
    }
}
