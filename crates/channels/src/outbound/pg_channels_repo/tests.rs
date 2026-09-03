use crate::domain::models::{
    AttachmentEntityReference, BotId, BotSenderProfile, ChannelMessageFilters, ChannelType,
    ChannelWithParticipants, CreateChannelRequest, CreateEntityMentionOptions, GetChannelsParams,
    GetChannelsRequest, GetThreadReplyRowsRequest, MessagePageDirection, NewChannelAttachment,
    NotificationFilters, ParticipantRole, PatchChannelRequest,
};
use crate::domain::ports::{ChannelListRepo, ChannelRepo};
use crate::outbound::pg_channels_repo::PgChannelsRepo;
use filter_ast::Expr;
use item_filters::ast::{
    LiteralTree,
    channel::{ChannelLiteral, ChannelThreadLiteral},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{CreatedAt, Cursor, CursorVal, Query, SimpleSortMethod};
use sqlx::{Pool, Postgres};
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};
use uuid::Uuid;

const NO_FILTERS: ChannelMessageFilters = ChannelMessageFilters {
    message_ids: Vec::new(),
    created_after: None,
    created_before: None,
    activity_after: None,
    activity_before: None,
    notification_filters: NotificationFilters {
        done: None,
        seen: None,
    },
};

const CH1: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000c01);
const CH2: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000c02);
const CH3: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000c03);
const TEAM_A: Uuid = Uuid::from_u128(0x11111111_1111_1111_1111_111111111111);
const TEAM_A_AUTO_ACTIVE: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000c11);
const TEAM_A_AUTO_LEFT: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000c12);
const TEAM_A_MANUAL: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000c13);
const TEAM_B_AUTO: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000c21);
const TEAM_OWNER_A: &str = "macro|team-owner-a@test.com";
const MSG1: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000001);
const MSG2: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000002);
const MSG3: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000003);
const MSG31: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000031);
const REPLY1: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_00000000b001);
const REPLY2: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_00000000b002);
const REPLY3: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_00000000b003);
const REPLY4: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_00000000b005);
const DELETED_MSG_ATTACHMENT: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_00000000a004);
const USER_A: &str = "macro|user-a@test.com";
const USER_B: &str = "macro|user-b@test.com";
const USER_C: &str = "macro|user-c@test.com";
const NON_MEMBER: &str = "macro|user-d@test.com";
const USER_E: &str = "macro|user-e@test.com";
const LEFT_USER: &str = "macro|left-user@test.com";
// Participant-filter fixture threads in ch4 (see channels_repo.sql).
const T41: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000041);
const T42: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000042);
const T43: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000043);
const T44: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000044);

fn repo(pool: Pool<Postgres>) -> PgChannelsRepo {
    PgChannelsRepo::new(pool)
}

fn macro_user_id(user_id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(user_id.to_owned()).expect("valid macro user id")
}

fn thread_rows_request(
    user_id: &str,
    filter: LiteralTree<ChannelThreadLiteral>,
    sort: SimpleSortMethod,
    limit: u32,
) -> GetThreadReplyRowsRequest {
    GetThreadReplyRowsRequest {
        macro_id: macro_user_id(user_id),
        limit: Some(limit),
        query: Query::Sort(sort, filter),
    }
}

fn thread_filter(literal: ChannelThreadLiteral) -> LiteralTree<ChannelThreadLiteral> {
    Some(Arc::new(Expr::val(literal)))
}

fn report_err(e: rootcause::Report) -> anyhow::Error {
    anyhow::anyhow!("{e:?}")
}

fn channels_params(user_id: &str, filter: LiteralTree<ChannelLiteral>) -> GetChannelsParams {
    GetChannelsRequest {
        macro_id: macro_user_id(user_id),
        limit: Some(50),
        include_frecency: false,
        query: Query::Sort(SimpleSortMethod::UpdatedAt, filter),
    }
    .into_params()
}

fn channel_filter(literal: ChannelLiteral) -> LiteralTree<ChannelLiteral> {
    Some(Arc::new(Expr::val(literal)))
}

fn participant_roles(channel: &ChannelWithParticipants) -> Vec<(String, ParticipantRole)> {
    let mut participants = channel
        .participants
        .iter()
        .map(|participant| {
            assert_eq!(participant.channel_id, channel.channel.id);
            assert!(participant.left_at.is_none());
            (participant.user_id.clone(), participant.role)
        })
        .collect::<Vec<_>>();
    participants.sort_by(|a, b| a.0.cmp(&b.0));
    participants
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_list_flags_active_participation(pool: Pool<Postgres>) {
    let repo = repo(pool);

    // left-user actively participates in c11 and c13 (Team A) and c21 (Team B).
    // Channels they left (c12, ch1, ch3, ch4) stay out of the unfiltered list,
    // including c12 despite their Team A membership.
    let channels = repo
        .get_user_channels_with_participants(channels_params(LEFT_USER, None))
        .await
        .unwrap();

    let ids: HashSet<Uuid> = channels.iter().map(|c| c.channel.id).collect();
    assert_eq!(
        ids,
        HashSet::from([TEAM_A_AUTO_ACTIVE, TEAM_A_MANUAL, TEAM_B_AUTO])
    );
    assert!(channels.iter().all(|c| c.is_participant));
    let auto_join_by_id: HashMap<_, _> = channels
        .iter()
        .map(|channel| (channel.channel.id, channel.channel.auto_join_team))
        .collect();
    assert_eq!(auto_join_by_id.get(&TEAM_A_AUTO_ACTIVE), Some(&true));
    assert_eq!(auto_join_by_id.get(&TEAM_A_MANUAL), Some(&false));
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_list_excludes_non_member_team_channels_by_default(pool: Pool<Postgres>) {
    let repo = repo(pool);

    // user-d is on Team B but never joined its channel c21: without an
    // IsParticipant filter the list stays participant-only.
    let channels = repo
        .get_user_channels_with_participants(channels_params(NON_MEMBER, None))
        .await
        .unwrap();

    assert!(channels.is_empty());
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn is_participant_filter_false_returns_non_member_team_channels(pool: Pool<Postgres>) {
    let repo = repo(pool);

    // For left-user the only Team A channel without an active membership is
    // c12 (they left it). Active channels and other teams' channels stay out.
    let channels = repo
        .get_user_channels_with_participants(channels_params(
            LEFT_USER,
            channel_filter(ChannelLiteral::IsParticipant(false)),
        ))
        .await
        .unwrap();

    let ids: Vec<Uuid> = channels.iter().map(|c| c.channel.id).collect();
    assert_eq!(ids, vec![TEAM_A_AUTO_LEFT]);
    assert!(!channels[0].is_participant);
    // Their own left row is not listed as a participant.
    assert!(channels[0].participants.is_empty());

    // user-d never joined Team B's channel c21: the filter surfaces it with
    // its active participants (left-user is still an active member there).
    let channels = repo
        .get_user_channels_with_participants(channels_params(
            NON_MEMBER,
            channel_filter(ChannelLiteral::IsParticipant(false)),
        ))
        .await
        .unwrap();

    let ids: Vec<Uuid> = channels.iter().map(|c| c.channel.id).collect();
    assert_eq!(ids, vec![TEAM_B_AUTO]);
    assert!(!channels[0].is_participant);
    assert_eq!(channels[0].participants.len(), 1);
    assert_eq!(channels[0].participants[0].user_id, LEFT_USER);
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn is_participant_filter_true_matches_default_membership(pool: Pool<Postgres>) {
    let repo = repo(pool);

    let filtered = repo
        .get_user_channels_with_participants(channels_params(
            LEFT_USER,
            channel_filter(ChannelLiteral::IsParticipant(true)),
        ))
        .await
        .unwrap();
    let unfiltered = repo
        .get_user_channels_with_participants(channels_params(LEFT_USER, None))
        .await
        .unwrap();

    let filtered_ids: HashSet<Uuid> = filtered.iter().map(|c| c.channel.id).collect();
    let unfiltered_ids: HashSet<Uuid> = unfiltered.iter().map(|c| c.channel.id).collect();
    assert_eq!(filtered_ids, unfiltered_ids);
    assert!(filtered.iter().all(|c| c.is_participant));
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn is_participant_filter_inside_not_widens_candidates(pool: Pool<Postgres>) {
    let repo = repo(pool);

    // NOT(IsParticipant(true)) must behave like IsParticipant(false): the
    // candidate widening walks the whole AST, not just top-level literals.
    let channels = repo
        .get_user_channels_with_participants(channels_params(
            LEFT_USER,
            Some(Arc::new(Expr::is_not(Expr::val(
                ChannelLiteral::IsParticipant(true),
            )))),
        ))
        .await
        .unwrap();

    let ids: Vec<Uuid> = channels.iter().map(|c| c.channel.id).collect();
    assert_eq!(ids, vec![TEAM_A_AUTO_LEFT]);
    assert!(!channels[0].is_participant);
}

#[sqlx::test(
    fixtures(
        path = "../../../fixtures",
        scripts("channels_repo", "channel_list_pagination")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_list_cursor_pagination_matches_unpaginated_results(pool: Pool<Postgres>) {
    let repo = repo(pool);

    for (sort, expected_ids) in [
        (SimpleSortMethod::CreatedAt, vec![CH3, CH1]),
        (SimpleSortMethod::UpdatedAt, vec![CH1, CH3]),
    ] {
        let unpaginated = repo
            .get_user_channels_with_participants(
                GetChannelsRequest {
                    macro_id: macro_user_id(USER_A),
                    limit: Some(50),
                    include_frecency: false,
                    query: Query::Sort(sort, None),
                }
                .into_params(),
            )
            .await
            .unwrap();
        let unpaginated_ids = unpaginated
            .iter()
            .map(|channel| channel.channel.id)
            .collect::<Vec<_>>();
        assert_eq!(unpaginated_ids, expected_ids);

        let mut query = Query::Sort(sort, None);
        let mut paginated = Vec::new();
        loop {
            let page = repo
                .get_user_channels_with_participants(
                    GetChannelsRequest {
                        macro_id: macro_user_id(USER_A),
                        limit: Some(1),
                        include_frecency: false,
                        query,
                    }
                    .into_params(),
                )
                .await
                .unwrap();
            let Some(last) = page.last() else {
                break;
            };
            assert_eq!(page.len(), 1);

            query = Query::Cursor(Cursor {
                id: last.channel.id,
                limit: 1,
                val: CursorVal {
                    sort_type: sort,
                    last_val: match sort {
                        SimpleSortMethod::CreatedAt => last.channel.created_at,
                        SimpleSortMethod::UpdatedAt => last.channel.updated_at,
                        _ => unreachable!("channel list test only uses supported sort methods"),
                    },
                },
                filter: None,
            });
            paginated.extend(page);
            assert!(
                paginated.len() <= unpaginated.len(),
                "cursor pagination returned duplicate rows"
            );
        }

        let paginated_ids = paginated
            .iter()
            .map(|channel| channel.channel.id)
            .collect::<Vec<_>>();
        assert_eq!(paginated_ids, unpaginated_ids);
        assert_eq!(paginated.len(), unpaginated.len());

        for (expected, actual) in unpaginated.iter().zip(&paginated) {
            assert_eq!(actual.channel.id, expected.channel.id);
            assert_eq!(actual.is_participant, expected.is_participant);
            assert_eq!(participant_roles(actual), participant_roles(expected));
            assert!(actual.is_participant);

            let expected_participants = match actual.channel.id {
                CH1 => vec![
                    (USER_A.to_string(), ParticipantRole::Owner),
                    (USER_B.to_string(), ParticipantRole::Admin),
                    (USER_C.to_string(), ParticipantRole::Member),
                ],
                CH3 => vec![(USER_A.to_string(), ParticipantRole::Owner)],
                id => panic!("unexpected channel {id}"),
            };
            assert_eq!(participant_roles(actual), expected_participants);
        }
    }
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn create_channel_persists_auto_join_team_and_adds_current_members(pool: Pool<Postgres>) {
    let repo = repo(pool.clone());

    let enabled_channel_id = repo
        .create_channel(
            macro_user_id(USER_A),
            None,
            CreateChannelRequest {
                name: Some("enabled".to_string()),
                channel_type: ChannelType::Team,
                team_id: Some(TEAM_A),
                auto_join_team: true,
                participants: HashSet::new(),
            },
        )
        .await
        .unwrap();
    let disabled_channel_id = repo
        .create_channel(
            macro_user_id(USER_A),
            None,
            CreateChannelRequest {
                name: Some("disabled".to_string()),
                channel_type: ChannelType::Team,
                team_id: Some(TEAM_A),
                auto_join_team: false,
                participants: HashSet::new(),
            },
        )
        .await
        .unwrap();

    let enabled = sqlx::query_scalar!(
        "SELECT auto_join_team FROM comms_channels WHERE id = $1",
        enabled_channel_id.id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let disabled = sqlx::query_scalar!(
        "SELECT auto_join_team FROM comms_channels WHERE id = $1",
        disabled_channel_id.id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let enabled_participants = sqlx::query!(
        r#"
        SELECT user_id, role AS "role: ParticipantRole"
        FROM comms_channel_participants
        WHERE channel_id = $1
        ORDER BY user_id
        "#,
        enabled_channel_id.id,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let disabled_participants = sqlx::query_scalar!(
        r#"
        SELECT user_id
        FROM comms_channel_participants
        WHERE channel_id = $1
        ORDER BY user_id
        "#,
        disabled_channel_id.id,
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    assert!(enabled);
    assert!(!disabled);
    assert_eq!(
        enabled_participants
            .iter()
            .map(|participant| (participant.user_id.as_str(), participant.role))
            .collect::<Vec<_>>(),
        vec![
            (LEFT_USER, ParticipantRole::Member),
            (USER_A, ParticipantRole::Owner),
        ]
    );
    assert_eq!(disabled_participants, vec![USER_A]);
    assert_eq!(
        enabled_channel_id.participant_user_ids,
        vec![macro_user_id(LEFT_USER), macro_user_id(USER_A)]
    );
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn maybe_get_dm_finds_channel_regardless_of_argument_order(pool: Pool<Postgres>) {
    let repo = repo(pool.clone());
    let user_a = macro_user_id(USER_A);
    let user_b = macro_user_id(USER_B);

    let created = repo
        .create_channel(
            user_a.clone(),
            None,
            CreateChannelRequest {
                name: None,
                channel_type: ChannelType::DirectMessage,
                team_id: None,
                auto_join_team: false,
                participants: HashSet::from([user_b.clone()]),
            },
        )
        .await
        .unwrap();

    let forward = repo
        .maybe_get_dm(user_a.clone(), user_b.clone())
        .await
        .unwrap();
    let reverse = repo.maybe_get_dm(user_b, user_a).await.unwrap();

    assert_eq!(forward, Some(created.id));
    assert_eq!(reverse, Some(created.id));
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_channel_rename_advances_updated_at(pool: Pool<Postgres>) {
    let repo = repo(pool.clone());
    let before = sqlx::query!(
        "SELECT name, updated_at FROM comms_channels WHERE id = $1",
        CH1,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    repo.patch_channel(
        CH1,
        USER_A.to_string(),
        None,
        PatchChannelRequest {
            channel_name: Some("renamed-channel".to_string()),
            convert_to_team_channel: None,
            auto_join_team: None,
        },
    )
    .await
    .unwrap();

    let after = sqlx::query!(
        "SELECT name, updated_at FROM comms_channels WHERE id = $1",
        CH1,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(after.name.as_deref(), Some("renamed-channel"));
    assert!(after.updated_at > before.updated_at);
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_channel_converts_to_team_and_updates_auto_join_members(pool: Pool<Postgres>) {
    let repo = repo(pool.clone());
    let user_id = macro_user_id(TEAM_OWNER_A);
    sqlx::query!(
        r#"
        INSERT INTO team_user (user_id, team_id, team_role)
        VALUES ($1, $2, 'admin'::team_role)
        "#,
        TEAM_OWNER_A,
        TEAM_A,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO comms_channel_participants (channel_id, user_id, role)
        VALUES ($1, $2, 'admin'::comms_participant_role)
        "#,
        CH1,
        TEAM_OWNER_A,
    )
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(repo.get_user_team_id(&user_id).await.unwrap(), Some(TEAM_A));

    repo.patch_channel(
        CH1,
        TEAM_OWNER_A.to_string(),
        Some(TEAM_A),
        PatchChannelRequest {
            channel_name: None,
            convert_to_team_channel: Some(true),
            auto_join_team: Some(true),
        },
    )
    .await
    .unwrap();

    let channel = sqlx::query!(
        r#"
        SELECT
            channel_type AS "channel_type: ChannelType",
            team_id,
            auto_join_team
        FROM comms_channels
        WHERE id = $1
        "#,
        CH1,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(channel.channel_type, ChannelType::Team);
    assert_eq!(channel.team_id, Some(TEAM_A));
    assert!(channel.auto_join_team);

    let rejoined_team_member = sqlx::query!(
        r#"
        SELECT role AS "role: ParticipantRole", left_at
        FROM comms_channel_participants
        WHERE channel_id = $1 AND user_id = $2
        "#,
        CH1,
        LEFT_USER,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(rejoined_team_member.role, ParticipantRole::Member);
    assert!(rejoined_team_member.left_at.is_none());

    let participant_count = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM comms_channel_participants WHERE channel_id = $1",
        CH1,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    repo.patch_channel(
        CH1,
        TEAM_OWNER_A.to_string(),
        Some(TEAM_A),
        PatchChannelRequest {
            channel_name: None,
            convert_to_team_channel: None,
            auto_join_team: Some(false),
        },
    )
    .await
    .unwrap();

    let auto_join_team = sqlx::query_scalar!(
        "SELECT auto_join_team FROM comms_channels WHERE id = $1",
        CH1,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let participant_count_after = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM comms_channel_participants WHERE channel_id = $1",
        CH1,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!auto_join_team);
    assert_eq!(participant_count_after, participant_count);
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_team_channel_converts_to_private_and_clears_team_settings(pool: Pool<Postgres>) {
    let repo = repo(pool.clone());
    let participant_count = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM comms_channel_participants WHERE channel_id = $1",
        TEAM_A_AUTO_ACTIVE,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    repo.patch_channel(
        TEAM_A_AUTO_ACTIVE,
        LEFT_USER.to_string(),
        None,
        PatchChannelRequest {
            channel_name: None,
            convert_to_team_channel: Some(false),
            auto_join_team: Some(true),
        },
    )
    .await
    .unwrap();

    let channel = sqlx::query!(
        r#"
        SELECT
            channel_type AS "channel_type: ChannelType",
            team_id,
            auto_join_team
        FROM comms_channels
        WHERE id = $1
        "#,
        TEAM_A_AUTO_ACTIVE,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(channel.channel_type, ChannelType::Private);
    assert_eq!(channel.team_id, None);
    assert!(!channel.auto_join_team);

    let participant_count_after = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM comms_channel_participants WHERE channel_id = $1",
        TEAM_A_AUTO_ACTIVE,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(participant_count_after, participant_count);
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn auto_join_is_enabled_team_scoped_and_idempotent(pool: Pool<Postgres>) {
    let repo = repo(pool.clone());
    let user_id = macro_user_id(NON_MEMBER);

    repo.auto_join_by_team_id(&TEAM_A, &user_id).await.unwrap();
    repo.auto_join_by_team_id(&TEAM_A, &user_id).await.unwrap();

    let channel_ids = sqlx::query_scalar!(
        r#"
        SELECT channel_id
        FROM comms_channel_participants
        WHERE user_id = $1
        ORDER BY channel_id
        "#,
        user_id.as_ref(),
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(channel_ids, vec![TEAM_A_AUTO_ACTIVE, TEAM_A_AUTO_LEFT]);
    assert!(!channel_ids.contains(&TEAM_A_MANUAL));
    assert!(!channel_ids.contains(&TEAM_B_AUTO));
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn auto_join_reactivates_left_members_without_changing_active_memberships(
    pool: Pool<Postgres>,
) {
    let repo = repo(pool.clone());
    let user_id = macro_user_id(LEFT_USER);
    let active_before = sqlx::query!(
        r#"
        SELECT role AS "role: ParticipantRole", joined_at
        FROM comms_channel_participants
        WHERE channel_id = $1 AND user_id = $2
        "#,
        TEAM_A_AUTO_ACTIVE,
        user_id.as_ref(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let left_before = sqlx::query!(
        r#"
        SELECT joined_at
        FROM comms_channel_participants
        WHERE channel_id = $1 AND user_id = $2
        "#,
        TEAM_A_AUTO_LEFT,
        user_id.as_ref(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    repo.auto_join_by_team_id(&TEAM_A, &user_id).await.unwrap();

    let active_after = sqlx::query!(
        r#"
        SELECT role AS "role: ParticipantRole", joined_at, left_at::timestamptz AS "left_at?"
        FROM comms_channel_participants
        WHERE channel_id = $1 AND user_id = $2
        "#,
        TEAM_A_AUTO_ACTIVE,
        user_id.as_ref(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let reactivated = sqlx::query!(
        r#"
        SELECT role AS "role: ParticipantRole", joined_at, left_at::timestamptz AS "left_at?"
        FROM comms_channel_participants
        WHERE channel_id = $1 AND user_id = $2
        "#,
        TEAM_A_AUTO_LEFT,
        user_id.as_ref(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(active_after.role, active_before.role);
    assert_eq!(active_after.joined_at, active_before.joined_at);
    assert!(active_after.left_at.is_none());
    assert_eq!(reactivated.role, ParticipantRole::Member);
    assert!(reactivated.joined_at > left_before.joined_at);
    assert!(reactivated.left_at.is_none());
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn leave_soft_leaves_all_team_channels_and_returns_only_changes(pool: Pool<Postgres>) {
    let repo = repo(pool.clone());
    let user_id = macro_user_id(LEFT_USER);
    let original_left_at = sqlx::query_scalar!(
        r#"
        SELECT left_at::timestamptz
        FROM comms_channel_participants
        WHERE channel_id = $1 AND user_id = $2
        "#,
        TEAM_A_AUTO_LEFT,
        user_id.as_ref(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    let mut changed = repo.leave_by_team_id(&TEAM_A, &user_id).await.unwrap();
    changed.sort_unstable();

    assert_eq!(changed, vec![TEAM_A_AUTO_ACTIVE, TEAM_A_MANUAL]);
    assert!(
        repo.leave_by_team_id(&TEAM_A, &user_id)
            .await
            .unwrap()
            .is_empty()
    );

    let team_a_active_count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) AS "count!"
        FROM comms_channel_participants cp
        JOIN comms_channels cc ON cc.id = cp.channel_id
        WHERE cc.team_id = $1 AND cp.user_id = $2 AND cp.left_at IS NULL
        "#,
        TEAM_A,
        user_id.as_ref(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let unchanged_left_at = sqlx::query_scalar!(
        r#"
        SELECT left_at::timestamptz
        FROM comms_channel_participants
        WHERE channel_id = $1 AND user_id = $2
        "#,
        TEAM_A_AUTO_LEFT,
        user_id.as_ref(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let other_team_left_at = sqlx::query_scalar!(
        r#"
        SELECT left_at::timestamptz
        FROM comms_channel_participants
        WHERE channel_id = $1 AND user_id = $2
        "#,
        TEAM_B_AUTO,
        user_id.as_ref(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(team_a_active_count, 0);
    assert_eq!(unchanged_left_at, original_left_at);
    assert!(other_team_left_at.is_none());
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn rollback_restores_exact_channels_without_changing_role_or_joined_at(pool: Pool<Postgres>) {
    let repo = repo(pool.clone());
    let user_id = macro_user_id(LEFT_USER);
    let before = sqlx::query!(
        r#"
        SELECT channel_id, role AS "role: ParticipantRole", joined_at
        FROM comms_channel_participants
        WHERE user_id = $1 AND channel_id = ANY($2)
        ORDER BY channel_id
        "#,
        user_id.as_ref(),
        &[TEAM_A_AUTO_ACTIVE, TEAM_A_MANUAL],
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let changed = repo.leave_by_team_id(&TEAM_A, &user_id).await.unwrap();

    repo.restore_by_channel_ids(&user_id, &changed)
        .await
        .unwrap();

    let restored = sqlx::query!(
        r#"
        SELECT channel_id, role AS "role: ParticipantRole", joined_at,
               left_at::timestamptz AS "left_at?"
        FROM comms_channel_participants
        WHERE user_id = $1 AND channel_id = ANY($2)
        ORDER BY channel_id
        "#,
        user_id.as_ref(),
        &[TEAM_A_AUTO_ACTIVE, TEAM_A_MANUAL],
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let previously_left = sqlx::query_scalar!(
        r#"
        SELECT left_at::timestamptz
        FROM comms_channel_participants
        WHERE channel_id = $1 AND user_id = $2
        "#,
        TEAM_A_AUTO_LEFT,
        user_id.as_ref(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(restored.len(), before.len());
    for (restored, before) in restored.iter().zip(before) {
        assert_eq!(restored.channel_id, before.channel_id);
        assert_eq!(restored.role, before.role);
        assert_eq!(restored.joined_at, before.joined_at);
        assert!(restored.left_at.is_none());
    }
    assert!(previously_left.is_some());
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn add_participant_atomically_adds_or_reactivates(pool: Pool<Postgres>) {
    let repo = repo(pool);

    assert!(
        !repo
            .add_participant(CH1, macro_user_id(USER_A), ParticipantRole::Member)
            .await
            .unwrap()
    );
    assert!(
        repo.add_participant(CH1, macro_user_id(LEFT_USER), ParticipantRole::Member)
            .await
            .unwrap()
    );
    assert!(
        !repo
            .add_participant(CH1, macro_user_id(LEFT_USER), ParticipantRole::Member)
            .await
            .unwrap()
    );
    assert!(
        repo.add_participant(CH1, macro_user_id(NON_MEMBER), ParticipantRole::Member)
            .await
            .unwrap()
    );
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_join_code_is_generated_once_and_reused(pool: Pool<Postgres>) {
    let repo = repo(pool);

    let first = repo.get_or_create_channel_join_code(CH1).await.unwrap();
    let second = repo.get_or_create_channel_join_code(CH1).await.unwrap();

    assert_eq!(first, second);
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_can_be_resolved_by_join_code(pool: Pool<Postgres>) {
    let repo = repo(pool);
    let join_code = repo.get_or_create_channel_join_code(CH1).await.unwrap();

    let channel = repo
        .get_channel_info_by_join_code(join_code)
        .await
        .unwrap()
        .unwrap();

    assert_eq!(channel.id, CH1);
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn unknown_channel_join_code_resolves_to_none(pool: Pool<Postgres>) {
    let repo = repo(pool);

    let channel = repo
        .get_channel_info_by_join_code(Uuid::new_v4())
        .await
        .unwrap();

    assert!(channel.is_none());
}

async fn insert_channel_message_notification(
    pool: &Pool<Postgres>,
    user_id: &str,
    channel_id: Uuid,
    message_id: Uuid,
    done: bool,
    seen: bool,
) -> anyhow::Result<()> {
    let notification_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO notification (
            id,
            notification_event_type,
            event_item_id,
            event_item_type,
            service_sender,
            metadata
        )
        VALUES (
            $1,
            'channel_message_send',
            $2,
            'channel',
            'channels-test',
            jsonb_build_object('messageId', $3::text)
        )
        "#,
        notification_id,
        channel_id.to_string(),
        message_id.to_string(),
    )
    .execute(pool)
    .await?;

    insert_user_notification(pool, user_id, notification_id, done, seen).await
}

async fn insert_channel_thread_notification(
    pool: &Pool<Postgres>,
    user_id: &str,
    channel_id: Uuid,
    thread_id: Uuid,
    done: bool,
    seen: bool,
) -> anyhow::Result<()> {
    let notification_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO notification (
            id,
            notification_event_type,
            event_item_id,
            event_item_type,
            service_sender,
            metadata,
            secondary_event_item_id,
            secondary_event_item_type
        )
        VALUES (
            $1,
            'channel_reply',
            $2,
            'channel',
            'channels-test',
            '{}'::jsonb,
            $3,
            'channel_message'
        )
        "#,
        notification_id,
        channel_id.to_string(),
        thread_id.to_string(),
    )
    .execute(pool)
    .await?;

    insert_user_notification(pool, user_id, notification_id, done, seen).await
}

async fn insert_user_notification(
    pool: &Pool<Postgres>,
    user_id: &str,
    notification_id: Uuid,
    done: bool,
    seen: bool,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO user_notification (user_id, notification_id, created_at, seen_at, done)
        VALUES (
            $1,
            $2,
            '2024-01-02 00:00:00'::timestamp,
            CASE WHEN $3::bool THEN '2024-01-02 00:00:00'::timestamp ELSE NULL END,
            $4
        )
        "#,
        user_id,
        notification_id,
        seen,
        done,
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn top_level_excludes_thread_replies_and_fully_deleted(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let result = repo
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &NO_FILTERS,
            None,
        )
        .await?;
    let rows = result.rows;

    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    // msg1, msg2 (deleted but has active reply), msg3 — but NOT msg4 (fully deleted)
    assert_eq!(ids.len(), 3);
    assert!(ids.contains(&MSG1));
    assert!(ids.contains(&MSG2));
    assert!(ids.contains(&MSG3));
    // msg4 (fully deleted, no active replies) must not appear
    let msg4 = Uuid::from_u128(0x00000000_0000_0000_0000_000000000004);
    assert!(!ids.contains(&msg4));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn top_level_ordered_newest_first(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let result = repo
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &NO_FILTERS,
            None,
        )
        .await?;
    let rows = result.rows;

    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG3, MSG2, MSG1]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_thread_rows_are_visible_to_channel_members(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let rows = repo
        .get_thread_messages(
            thread_rows_request(USER_A, None, SimpleSortMethod::UpdatedAt, 50).into_params(),
        )
        .await
        .map_err(report_err)?;

    let parent_ids = rows.iter().map(|row| row.id).collect::<Vec<_>>();
    assert_eq!(parent_ids, vec![MSG3, MSG1, MSG31]);

    let msg1 = rows
        .iter()
        .find(|row| row.id == MSG1)
        .expect("msg1 thread should be returned");
    assert_eq!(msg1.thread.reply_count, 4);
    let reply_ids = msg1
        .thread
        .preview
        .iter()
        .map(|reply| reply.id)
        .collect::<Vec<_>>();
    assert_eq!(reply_ids, vec![REPLY1, REPLY2, REPLY3]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_thread_rows_are_scoped_to_active_channel_members(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let rows = repo
        .get_thread_messages(
            thread_rows_request(NON_MEMBER, None, SimpleSortMethod::UpdatedAt, 50).into_params(),
        )
        .await
        .map_err(report_err)?;

    assert!(rows.is_empty());
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_thread_rows_filter_by_thread_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let rows = repo
        .get_thread_messages(
            thread_rows_request(
                USER_A,
                thread_filter(ChannelThreadLiteral::ThreadId(MSG1)),
                SimpleSortMethod::UpdatedAt,
                50,
            )
            .into_params(),
        )
        .await
        .map_err(report_err)?;

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, MSG1);
    assert_eq!(rows[0].thread.reply_count, 4);
    let reply_ids = rows[0]
        .thread
        .preview
        .iter()
        .map(|reply| reply.id)
        .collect::<Vec<_>>();
    assert_eq!(reply_ids, vec![REPLY1, REPLY2, REPLY3]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_thread_rows_filter_by_channel_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let rows = repo
        .get_thread_messages(
            thread_rows_request(
                USER_A,
                thread_filter(ChannelThreadLiteral::ChannelId(CH2)),
                SimpleSortMethod::UpdatedAt,
                50,
            )
            .into_params(),
        )
        .await
        .map_err(report_err)?;

    assert!(rows.is_empty());
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_thread_rows_filter_by_root_sender(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let rows = repo
        .get_thread_messages(
            thread_rows_request(
                USER_A,
                thread_filter(ChannelThreadLiteral::RootSender(macro_user_id(USER_A))),
                SimpleSortMethod::UpdatedAt,
                50,
            )
            .into_params(),
        )
        .await
        .map_err(report_err)?;

    let parent_ids = rows.iter().map(|row| row.id).collect::<Vec<_>>();
    assert_eq!(parent_ids, vec![MSG3, MSG1, MSG31]);
    Ok(())
}

async fn threads_matching_participant(
    pool: Pool<Postgres>,
    querying_user: &str,
    participant: &str,
) -> anyhow::Result<Vec<Uuid>> {
    let rows = repo(pool)
        .get_thread_messages(
            thread_rows_request(
                querying_user,
                thread_filter(ChannelThreadLiteral::Participant(macro_user_id(
                    participant,
                ))),
                SimpleSortMethod::UpdatedAt,
                50,
            )
            .into_params(),
        )
        .await
        .map_err(report_err)?;
    Ok(rows.iter().map(|row| row.id).collect())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_thread_rows_filter_by_participant_reply_and_mention(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // user-c replied in t41, is @-mentioned in t42, and is in the @here expansion
    // rows on t43/t44. No ch1 threads match despite user-c being a ch1 member.
    let parent_ids = threads_matching_participant(pool, USER_B, USER_C).await?;
    assert_eq!(parent_ids, vec![T44, T43, T42, T41]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_thread_rows_filter_by_participant_group_mention(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // user-e's only reply is soft-deleted, so they match only through the @here
    // expansion rows: t43 (root @here) and t44 (reply @here).
    let parent_ids = threads_matching_participant(pool, USER_B, USER_E).await?;
    assert_eq!(parent_ids, vec![T44, T43]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_thread_rows_filter_by_participant_root_sender(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // user-b rooted every ch4 thread and replied to msg1 in ch1; msg3 doesn't match
    // because channel membership alone doesn't make a participant.
    let parent_ids = threads_matching_participant(pool, USER_B, USER_B).await?;
    assert_eq!(parent_ids, vec![T44, T43, T42, T41, MSG1]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_thread_rows_filter_by_participant_excludes_departed_users(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // left-user replied in t41 and sits in the @here expansion rows on t43/t44, but
    // they left the channel, so nothing matches.
    let parent_ids = threads_matching_participant(pool, USER_B, LEFT_USER).await?;
    assert!(parent_ids.is_empty());
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_thread_rows_filter_by_notification_done_secondary_entity(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_channel_message_notification(&pool, USER_A, CH1, MSG3, true, false).await?;
    insert_channel_thread_notification(&pool, USER_A, CH1, MSG1, true, false).await?;
    insert_channel_thread_notification(&pool, USER_A, CH1, MSG31, false, false).await?;
    insert_channel_thread_notification(&pool, USER_B, CH1, MSG3, true, false).await?;

    let rows = repo(pool)
        .get_thread_messages(
            thread_rows_request(
                USER_A,
                thread_filter(ChannelThreadLiteral::NotificationDone(true)),
                SimpleSortMethod::UpdatedAt,
                50,
            )
            .into_params(),
        )
        .await
        .map_err(report_err)?;

    let parent_ids = rows.iter().map(|row| row.id).collect::<Vec<_>>();
    assert_eq!(parent_ids, vec![MSG1]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_thread_rows_filter_by_notification_seen_secondary_entity(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_channel_thread_notification(&pool, USER_A, CH1, MSG3, false, false).await?;
    insert_channel_thread_notification(&pool, USER_A, CH1, MSG1, false, true).await?;
    insert_channel_thread_notification(&pool, USER_A, CH1, MSG31, false, false).await?;

    let rows = repo(pool)
        .get_thread_messages(
            thread_rows_request(
                USER_A,
                thread_filter(ChannelThreadLiteral::NotificationSeen(true)),
                SimpleSortMethod::UpdatedAt,
                50,
            )
            .into_params(),
        )
        .await
        .map_err(report_err)?;

    let parent_ids = rows.iter().map(|row| row.id).collect::<Vec<_>>();
    assert_eq!(parent_ids, vec![MSG1]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_thread_rows_apply_cursor(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let first_page = repo
        .get_thread_messages(
            thread_rows_request(USER_A, None, SimpleSortMethod::UpdatedAt, 1).into_params(),
        )
        .await
        .map_err(report_err)?;
    assert_eq!(first_page.len(), 1);
    assert_eq!(first_page[0].id, MSG3);

    let second_page = repo
        .get_thread_messages(
            GetThreadReplyRowsRequest {
                macro_id: macro_user_id(USER_A),
                limit: Some(50),
                query: Query::Cursor(Cursor {
                    id: first_page[0].id,
                    limit: 50,
                    val: CursorVal {
                        sort_type: SimpleSortMethod::UpdatedAt,
                        last_val: first_page[0].updated_at,
                    },
                    filter: None,
                }),
            }
            .into_params(),
        )
        .await
        .map_err(report_err)?;

    let parent_ids = second_page.iter().map(|row| row.id).collect::<Vec<_>>();
    assert_eq!(parent_ids, vec![MSG1, MSG31]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn message_context_returns_chronological_window(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let messages = repo.get_messages_with_context(CH1, REPLY2, 2, 1).await?;

    let ids = messages
        .iter()
        .map(|message| message.id)
        .collect::<Vec<_>>();
    assert_eq!(ids, vec![MSG1, REPLY1, REPLY2, REPLY3]);
    assert_eq!(messages[2].thread_id, Some(MSG1));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn message_context_is_bound_to_channel(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let messages = repo.get_messages_with_context(CH2, MSG1, 1, 1).await?;

    assert!(messages.is_empty());
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn top_level_cursor_skips_earlier_messages(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    // First fetch all to get cursor values
    let all = repo
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &NO_FILTERS,
            None,
        )
        .await?
        .rows;
    assert_eq!(all.len(), 3);

    // Use msg3 (newest) as cursor → should skip msg3, return msg2 + msg1
    let cursor = Query::Cursor(Cursor {
        id: MSG3,
        limit: 50,
        val: CursorVal {
            sort_type: CreatedAt,
            last_val: all[0].created_at,
        },
        filter: (),
    });
    let page2 = repo
        .get_top_level_messages(
            CH1,
            &cursor,
            MessagePageDirection::Older,
            50,
            &NO_FILTERS,
            None,
        )
        .await?
        .rows;
    let ids: Vec<Uuid> = page2.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG2, MSG1]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn top_level_newer_direction_returns_nearest_newer_page(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let all = repo
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &NO_FILTERS,
            None,
        )
        .await?
        .rows;

    let oldest = all.last().expect("at least one message");
    let cursor = Query::Cursor(Cursor {
        id: oldest.id,
        limit: 2,
        val: CursorVal {
            sort_type: CreatedAt,
            last_val: oldest.created_at,
        },
        filter: (),
    });
    let page = repo
        .get_top_level_messages(
            CH1,
            &cursor,
            MessagePageDirection::Newer,
            2,
            &NO_FILTERS,
            None,
        )
        .await?;

    let ids: Vec<Uuid> = page.rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG3, MSG2]);
    assert!(!page.has_more_newer);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn top_level_newer_direction_sets_has_more_newer_with_overfetch(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let all = repo
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &NO_FILTERS,
            None,
        )
        .await?
        .rows;

    let oldest = all.last().expect("at least one message");
    let cursor = Query::Cursor(Cursor {
        id: oldest.id,
        limit: 1,
        val: CursorVal {
            sort_type: CreatedAt,
            last_val: oldest.created_at,
        },
        filter: (),
    });
    let page = repo
        .get_top_level_messages(
            CH1,
            &cursor,
            MessagePageDirection::Newer,
            1,
            &NO_FILTERS,
            None,
        )
        .await?;

    let ids: Vec<Uuid> = page.rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG2], "nearest newer message is returned");
    assert!(page.has_more_newer, "there is still a newer page (MSG3)");
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn top_level_limit_is_respected(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let result = repo
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            2,
            &NO_FILTERS,
            None,
        )
        .await?;
    let rows = result.rows;

    assert_eq!(rows.len(), 2);
    // Should be the 2 newest
    assert_eq!(rows[0].id, MSG3);
    assert_eq!(rows[1].id, MSG2);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn top_level_scoped_to_channel(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let result = repo
        .get_top_level_messages(
            CH2,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &NO_FILTERS,
            None,
        )
        .await?;
    let rows = result.rows;

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].content, "other channel msg");
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn top_level_message_ids_filter_limits_to_subset(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let filters = ChannelMessageFilters {
        message_ids: vec![MSG1, MSG3],
        ..Default::default()
    };
    let result = repo
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &filters,
            None,
        )
        .await?;

    let ids: Vec<Uuid> = result.rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG3, MSG1]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn thread_data_preview_count_limits_replies(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    // msg1 has 4 replies; ask for preview of 2
    let map = repo.get_thread_data(&[MSG1], 2).await?;
    let thread = map.get(&MSG1).expect("thread data for msg1");

    assert_eq!(
        thread.reply_count, 4,
        "reply_count reflects total, not preview"
    );
    assert_eq!(
        thread.preview_replies.len(),
        2,
        "only 2 preview replies returned"
    );
    // Preview should be the 2 oldest replies, in chronological order
    assert_eq!(thread.preview_replies[0].content, "reply 1");
    assert_eq!(thread.preview_replies[1].content, "reply 2");
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn thread_data_latest_reply_at_is_most_recent(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let map = repo.get_thread_data(&[MSG1], 10).await?;
    let thread = map.get(&MSG1).unwrap();

    // reply 4 is at 10:04 — should be the latest
    let last = thread.preview_replies.last().unwrap();
    assert_eq!(thread.latest_reply_at, Some(last.created_at));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn thread_data_multiple_parents(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let map = repo.get_thread_data(&[MSG1, MSG2], 10).await?;

    assert!(map.contains_key(&MSG1));
    assert!(map.contains_key(&MSG2));
    assert_eq!(map[&MSG1].reply_count, 4);
    assert_eq!(map[&MSG2].reply_count, 1);
    assert_eq!(map[&MSG2].preview_replies[0].content, "reply to deleted");
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn thread_replies_returns_all_active_replies_oldest_first(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let replies = repo.get_thread_replies(MSG1).await?;

    let ids: Vec<Uuid> = replies.iter().map(|r| r.id).collect();
    assert_eq!(ids.len(), 4);
    assert_eq!(ids[0], REPLY1);
    assert_eq!(
        ids[3],
        Uuid::from_u128(0x00000000_0000_0000_0000_00000000b004)
    );
    let content: Vec<&str> = replies.iter().map(|r| r.content.as_str()).collect();
    assert_eq!(content, vec!["reply 1", "reply 2", "reply 3", "reply 4"]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn thread_replies_returns_non_null_edited_at(pool: Pool<Postgres>) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        UPDATE comms_messages
        SET edited_at = '2024-01-01 10:05:00'
        WHERE id = '00000000-0000-0000-0000-00000000b003'
        "#,
    )
    .execute(&pool)
    .await?;

    let repo = repo(pool);
    let replies = repo.get_thread_replies(MSG1).await?;
    let edited_reply = replies
        .into_iter()
        .find(|r| r.id == Uuid::from_u128(0x00000000_0000_0000_0000_00000000b003))
        .expect("expected fixture reply");

    assert!(edited_reply.edited_at.is_some());
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn thread_replies_excludes_deleted_rows(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let fully_deleted_parent = Uuid::from_u128(0x00000000_0000_0000_0000_000000000004);
    let deleted_parent_replies = repo.get_thread_replies(fully_deleted_parent).await?;
    assert!(
        deleted_parent_replies.is_empty(),
        "deleted replies should not be returned"
    );

    let active_replies = repo.get_thread_replies(MSG2).await?;
    assert_eq!(active_replies.len(), 1);
    assert_eq!(active_replies[0].id, REPLY4);
    assert_eq!(active_replies[0].content, "reply to deleted");
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn reactions_grouped_by_emoji(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let map = repo.get_reactions_batch(&[MSG1, MSG3]).await?;

    // msg1 has thumbsup (2 users) and tada (1 user), and should always come back in
    // first-reacted-at order (thumbsup before tada) rather than shuffled, since the
    // fixture reacts thumbsup before tada.
    let msg1_reactions = map.get(&MSG1).unwrap();
    assert_eq!(
        msg1_reactions
            .iter()
            .map(|r| r.emoji.as_str())
            .collect::<Vec<_>>(),
        vec!["\u{1f44d}", "\u{1f389}"]
    );
    let thumbsup = msg1_reactions
        .iter()
        .find(|r| r.emoji == "\u{1f44d}")
        .unwrap();
    assert_eq!(thumbsup.users.len(), 2);
    let tada = msg1_reactions
        .iter()
        .find(|r| r.emoji == "\u{1f389}")
        .unwrap();
    assert_eq!(tada.users.len(), 1);

    // msg3 has thumbsup (1 user)
    let msg3_reactions = map.get(&MSG3).unwrap();
    assert_eq!(msg3_reactions.len(), 1);
    assert_eq!(msg3_reactions[0].users.len(), 1);

    // msg2 has no reactions
    assert!(!map.contains_key(&MSG2));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn attachments_batch_grouped_by_message(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let map = repo.get_attachments_batch(&[MSG1, MSG2, MSG3]).await?;

    assert_eq!(map[&MSG1].len(), 2);
    assert_eq!(map[&MSG2].len(), 1);
    assert_eq!(map[&MSG3].len(), 1);
    assert_eq!(map[&MSG2][0].id, DELETED_MSG_ATTACHMENT);
    Ok(())
}

// -- get_channel_attachments -----------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_attachments_cursor_pagination(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    // ch1 has 3 attachments total (a001, a002 on msg1, a003 on msg3)
    let page1 = repo
        .get_channel_attachments(CH1, &Query::Sort(CreatedAt, ()), 2, None)
        .await?;
    assert_eq!(page1.len(), 2, "limit respected");

    // Use last item as cursor for next page
    let last = &page1[1];
    let cursor = Query::Cursor(Cursor {
        id: last.id,
        limit: 2,
        val: CursorVal {
            sort_type: CreatedAt,
            last_val: last.created_at,
        },
        filter: (),
    });
    let page2 = repo.get_channel_attachments(CH1, &cursor, 2, None).await?;
    assert_eq!(page2.len(), 1, "remaining attachment");

    // No overlap between pages
    let p1_ids: Vec<Uuid> = page1.iter().map(|a| a.id).collect();
    let p2_ids: Vec<Uuid> = page2.iter().map(|a| a.id).collect();
    assert!(p1_ids.iter().all(|id| !p2_ids.contains(id)));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_attachments_include_dimensions(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let all = repo
        .get_channel_attachments(CH1, &Query::Sort(CreatedAt, ()), 50, None)
        .await?;

    let img = all.iter().find(|a| a.entity_type == "image").unwrap();
    assert_eq!(img.width, Some(800));
    assert_eq!(img.height, Some(600));

    let doc = all.iter().find(|a| a.entity_id == "doc-1").unwrap();
    assert_eq!(doc.width, None);
    assert_eq!(doc.height, None);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_attachments_exclude_deleted_messages(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let all = repo
        .get_channel_attachments(CH1, &Query::Sort(CreatedAt, ()), 50, None)
        .await?;

    let ids: Vec<Uuid> = all.iter().map(|a| a.id).collect();
    assert_eq!(
        ids.len(),
        3,
        "only attachments from non-deleted messages are returned"
    );
    assert!(!ids.contains(&DELETED_MSG_ATTACHMENT));
    assert!(all.iter().all(|a| a.message_id != MSG2));
    Ok(())
}

// -- get_channel_participants ----------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn participants_excludes_left_users(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let participants = repo.get_channel_participants(CH1).await?;

    let user_ids: Vec<&str> = participants.iter().map(|p| p.user_id.as_str()).collect();
    assert_eq!(participants.len(), 3);
    assert!(!user_ids.contains(&"macro|left-user@test.com"));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn participants_roles_parsed_correctly(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let participants = repo.get_channel_participants(CH1).await?;

    let owner = participants
        .iter()
        .find(|p| p.user_id == "macro|user-a@test.com")
        .unwrap();
    assert_eq!(owner.role, ParticipantRole::Owner);

    let admin = participants
        .iter()
        .find(|p| p.user_id == "macro|user-b@test.com")
        .unwrap();
    assert_eq!(admin.role, ParticipantRole::Admin);

    let member = participants
        .iter()
        .find(|p| p.user_id == "macro|user-c@test.com")
        .unwrap();
    assert_eq!(member.role, ParticipantRole::Member);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_participant_readers_handle_bot_principals(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // An unnamed private channel resolves its display name from its
    // participants; bot participants contribute their bot name (never their
    // raw `bot|<uuid>` principal) and must not fail the call.
    let channel_id = Uuid::from_u128(0x00000000_0000_0000_0000_000000000c31);
    let bot_uuid = Uuid::from_u128(0x00000000_0000_0000_0000_0000_b0b0);
    sqlx::query(
        "INSERT INTO comms_channels (id, name, channel_type, owner_id, created_at, updated_at)
         VALUES ($1, NULL, 'private', $2, now(), now())",
    )
    .bind(channel_id)
    .bind(USER_A)
    .execute(&pool)
    .await?;
    sqlx::query(
        "INSERT INTO bots (id, kind, owner_user_id, name, handle, created_by)
         VALUES ($1, 'owned', $2, 'Deploy Bot', 'deploybot', $2)",
    )
    .bind(bot_uuid)
    .bind(USER_A)
    .execute(&pool)
    .await?;
    sqlx::query(
        "INSERT INTO comms_channel_participants (channel_id, user_id, role) VALUES
         ($1, $2, 'owner'),
         ($1, $3, 'member'),
         ($1, $4, 'member')",
    )
    .bind(channel_id)
    .bind(USER_A)
    .bind(USER_B)
    .bind(format!("bot|{bot_uuid}"))
    .execute(&pool)
    .await?;

    let repo = repo(pool);
    let metadata = repo
        .get_channel_metadata(channel_id, MacroUserIdStr::try_from(USER_A.to_string())?)
        .await?;
    let participants = repo.get_participants(channel_id).await?;

    assert_eq!(metadata.channel_type, ChannelType::Private);
    assert!(
        !metadata.channel_name.contains("bot|"),
        "raw bot principals must not appear in the channel display name: {}",
        metadata.channel_name
    );
    assert!(
        metadata.channel_name.contains("user-b"),
        "user participants should appear in the channel display name: {}",
        metadata.channel_name
    );
    assert!(
        metadata.channel_name.contains("Deploy Bot"),
        "bot participants should appear by bot name in the channel display name: {}",
        metadata.channel_name
    );
    assert!(
        participants
            .iter()
            .any(|participant| participant.user_id == format!("bot|{bot_uuid}")),
        "the mutation-time participant snapshot must retain installed bots"
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn thread_participants_exclude_departed_senders(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    // ch3 thread parent (msg id 0x..31) was authored by an active participant,
    // while its only reply was authored by a participant who has since left.
    let parent = Uuid::from_u128(0x00000000_0000_0000_0000_000000000031);
    let participants = repo.get_thread_participants(parent).await?;

    let ids: Vec<&str> = participants.iter().map(|p| p.as_ref()).collect();
    assert!(
        ids.contains(&USER_A),
        "active thread participant should be included"
    );
    assert!(
        !ids.contains(&LEFT_USER),
        "departed sender must not be treated as a thread participant"
    );
    Ok(())
}

// -- resolve_top_level_parent -------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn resolve_top_level_parent_returns_self_for_top_level(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let row = repo.resolve_top_level_parent(CH1, MSG1).await?;

    let row = row.expect("top-level message should resolve to itself");
    assert_eq!(row.id, MSG1);
    assert_eq!(row.content, "first message");
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn resolve_top_level_parent_follows_thread_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    // REPLY1 (b001) is a reply to MSG1
    let row = repo.resolve_top_level_parent(CH1, REPLY1).await?;

    let row = row.expect("thread reply should resolve to parent");
    assert_eq!(row.id, MSG1);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn resolve_top_level_parent_follows_reply_to_deleted_parent(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    // REPLY5 (b005) is a reply to MSG2 (which is soft-deleted but has active reply)
    let row = repo.resolve_top_level_parent(CH1, REPLY4).await?;

    let row = row.expect("reply to deleted parent should still resolve");
    assert_eq!(row.id, MSG2);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn resolve_top_level_parent_returns_none_for_nonexistent(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let missing = Uuid::from_u128(0xdeadbeef);
    let row = repo.resolve_top_level_parent(CH1, missing).await?;

    assert!(row.is_none(), "nonexistent message should return None");
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn resolve_top_level_parent_returns_none_for_wrong_channel(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    // MSG1 is in CH1, query it against CH2
    let row = repo.resolve_top_level_parent(CH2, MSG1).await?;

    assert!(
        row.is_none(),
        "message in different channel should return None"
    );
    Ok(())
}

// -- get_top_level_messages_around --------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn around_middle_message_returns_both_sides(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    // Anchor on MSG2 (11:00). Before should have MSG1, after should have MSG3.
    let anchor = repo
        .resolve_top_level_parent(CH1, MSG2)
        .await?
        .expect("msg2 exists");

    let (before, after) = repo
        .get_top_level_messages_around(CH1, anchor.created_at, anchor.id, 50)
        .await?;

    let before_ids: Vec<Uuid> = before.iter().map(|r| r.id).collect();
    let after_ids: Vec<Uuid> = after.iter().map(|r| r.id).collect();

    assert_eq!(before_ids, vec![MSG1], "MSG1 is older than anchor");
    assert_eq!(after_ids, vec![MSG3], "MSG3 is newer than anchor");
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn around_oldest_message_has_no_before(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let anchor = repo
        .resolve_top_level_parent(CH1, MSG1)
        .await?
        .expect("msg1 exists");

    let (before, after) = repo
        .get_top_level_messages_around(CH1, anchor.created_at, anchor.id, 50)
        .await?;

    assert!(before.is_empty(), "nothing older than MSG1");
    let after_ids: Vec<Uuid> = after.iter().map(|r| r.id).collect();
    assert_eq!(after_ids, vec![MSG2, MSG3]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn around_newest_message_has_no_after(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let anchor = repo
        .resolve_top_level_parent(CH1, MSG3)
        .await?
        .expect("msg3 exists");

    let (before, after) = repo
        .get_top_level_messages_around(CH1, anchor.created_at, anchor.id, 50)
        .await?;

    let before_ids: Vec<Uuid> = before.iter().map(|r| r.id).collect();
    assert_eq!(before_ids, vec![MSG2, MSG1]);
    assert!(after.is_empty(), "nothing newer than MSG3");
    Ok(())
}

// -- last_activity filter -----------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn last_activity_filters_by_message_created_at(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    // msg3 created at 12:00 — only it was created after 11:30
    let filters = ChannelMessageFilters {
        activity_after: Some(
            chrono::DateTime::parse_from_rfc3339("2024-01-01T11:30:00Z")
                .unwrap()
                .with_timezone(&chrono::Utc),
        ),
        ..Default::default()
    };
    let result = repo
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &filters,
            None,
        )
        .await?;

    let ids: Vec<Uuid> = result.rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG3]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn last_activity_includes_messages_with_recent_thread_replies(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    // msg1 created at 10:00 but has replies up to 10:04.
    // msg2 (deleted) has reply at 11:01.
    // msg3 created at 12:00.
    // last_activity = 10:05 excludes msg1 (created 10:00, last reply 10:04),
    // but includes msg2 (reply at 11:01) and msg3 (created 12:00).
    let filters = ChannelMessageFilters {
        activity_after: Some(
            chrono::DateTime::parse_from_rfc3339("2024-01-01T10:05:00Z")
                .unwrap()
                .with_timezone(&chrono::Utc),
        ),
        ..Default::default()
    };
    let result = repo
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &filters,
            None,
        )
        .await?;

    let ids: Vec<Uuid> = result.rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG3, MSG2]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn last_activity_combined_with_message_ids(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    // Ask for msg1 and msg3, but with last_activity that excludes msg1
    let filters = ChannelMessageFilters {
        message_ids: vec![MSG1, MSG3],
        activity_after: Some(
            chrono::DateTime::parse_from_rfc3339("2024-01-01T11:00:00Z")
                .unwrap()
                .with_timezone(&chrono::Utc),
        ),
        ..Default::default()
    };
    let result = repo
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &filters,
            None,
        )
        .await?;

    let ids: Vec<Uuid> = result.rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG3]);
    Ok(())
}

// -- notification filters -----------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn notification_done_filter_matches_top_level_messages_and_thread_replies(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_channel_message_notification(&pool, USER_A, CH1, MSG3, true, false).await?;
    insert_channel_message_notification(&pool, USER_A, CH1, REPLY1, true, false).await?;
    insert_channel_message_notification(&pool, USER_A, CH1, MSG2, false, false).await?;

    let filters = ChannelMessageFilters {
        notification_filters: NotificationFilters {
            done: Some(true),
            seen: None,
        },
        ..Default::default()
    };
    let result = repo(pool)
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &filters,
            Some(macro_user_id(USER_A)),
        )
        .await?;

    let ids: Vec<Uuid> = result.rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG3, MSG1]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn notification_not_done_filter_matches_top_level_messages_and_thread_replies(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_channel_message_notification(&pool, USER_A, CH1, MSG3, false, false).await?;
    insert_channel_message_notification(&pool, USER_A, CH1, REPLY1, false, false).await?;
    insert_channel_message_notification(&pool, USER_A, CH1, MSG2, true, false).await?;

    let filters = ChannelMessageFilters {
        notification_filters: NotificationFilters {
            done: Some(false),
            seen: None,
        },
        ..Default::default()
    };
    let result = repo(pool)
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &filters,
            Some(macro_user_id(USER_A)),
        )
        .await?;

    let ids: Vec<Uuid> = result.rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG3, MSG1]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn notification_seen_filter_matches_top_level_messages_and_thread_replies(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_channel_message_notification(&pool, USER_A, CH1, MSG3, false, true).await?;
    insert_channel_message_notification(&pool, USER_A, CH1, REPLY1, false, true).await?;
    insert_channel_message_notification(&pool, USER_A, CH1, REPLY4, false, true).await?;

    let filters = ChannelMessageFilters {
        notification_filters: NotificationFilters {
            done: None,
            seen: Some(true),
        },
        ..Default::default()
    };
    let result = repo(pool)
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &filters,
            Some(macro_user_id(USER_A)),
        )
        .await?;

    let ids: Vec<Uuid> = result.rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG3, MSG2, MSG1]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn notification_not_seen_filter_matches_top_level_messages_and_thread_replies(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_channel_message_notification(&pool, USER_A, CH1, MSG3, false, false).await?;
    insert_channel_message_notification(&pool, USER_A, CH1, REPLY1, false, false).await?;
    insert_channel_message_notification(&pool, USER_A, CH1, MSG2, false, true).await?;

    let filters = ChannelMessageFilters {
        notification_filters: NotificationFilters {
            done: None,
            seen: Some(false),
        },
        ..Default::default()
    };
    let result = repo(pool)
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &filters,
            Some(macro_user_id(USER_A)),
        )
        .await?;

    let ids: Vec<Uuid> = result.rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG3, MSG1]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn notification_done_and_seen_filters_match_soup_independent_exists_semantics(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_channel_message_notification(&pool, USER_A, CH1, MSG3, false, true).await?;
    insert_channel_message_notification(&pool, USER_A, CH1, MSG3, true, false).await?;

    let filters = ChannelMessageFilters {
        notification_filters: NotificationFilters {
            done: Some(false),
            seen: Some(false),
        },
        ..Default::default()
    };
    let result = repo(pool)
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &filters,
            Some(macro_user_id(USER_A)),
        )
        .await?;

    let ids: Vec<Uuid> = result.rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG3]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn notification_filter_is_scoped_to_requesting_user(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_channel_message_notification(&pool, USER_B, CH1, MSG3, false, false).await?;

    let filters = ChannelMessageFilters {
        notification_filters: NotificationFilters {
            done: Some(false),
            seen: None,
        },
        ..Default::default()
    };
    let result = repo(pool)
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &filters,
            Some(macro_user_id(USER_A)),
        )
        .await?;

    assert!(result.rows.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn notification_filter_requires_requesting_user(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let filters = ChannelMessageFilters {
        notification_filters: NotificationFilters {
            done: Some(false),
            seen: None,
        },
        ..Default::default()
    };

    let result = repo(pool)
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &filters,
            None,
        )
        .await;

    let Err(err) = result else {
        anyhow::bail!("notification filters require a user id");
    };
    assert_eq!(
        err.to_string(),
        "notification_user_id is required when notification_filters are set"
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channels_repo"))
)]
async fn batch_preview_returns_existing_public_channel(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let rows = repo(pool)
        .batch_get_channel_previews(&[CH1.to_string()], USER_A, None)
        .await?;

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].info.id, CH1);
    assert!(rows[0].has_access);
    Ok(())
}

fn mention_opts(
    source_id: &str,
    entity_type: &str,
    entity_id: &str,
    user_id: Option<&str>,
) -> CreateEntityMentionOptions {
    CreateEntityMentionOptions {
        source_entity_type: "document".to_string(),
        source_entity_id: source_id.to_string(),
        entity_type: entity_type.to_string(),
        entity_id: entity_id.to_string(),
        user_id: user_id.map(str::to_string),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_entity_mention_persists_row(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let mention = repo
        .create_entity_mention(mention_opts("doc-1", "user", "user-x", Some(USER_A)))
        .await?;

    assert_eq!(mention.source_entity_type, "document");
    assert_eq!(mention.source_entity_id, "doc-1");
    assert_eq!(mention.entity_type, "user");
    assert_eq!(mention.entity_id, "user-x");
    assert_eq!(mention.user_id.as_deref(), Some(USER_A));

    let fetched = repo
        .get_entity_mention_by_id(mention.id)
        .await?
        .expect("mention should exist");
    assert_eq!(fetched.id, mention.id);
    assert_eq!(fetched.source_entity_id, "doc-1");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_entity_mention_allows_duplicates(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let opts = mention_opts("doc-2", "user", "user-y", None);

    let first = repo.create_entity_mention(opts.clone()).await?;
    let second = repo.create_entity_mention(opts).await?;
    assert_ne!(first.id, second.id);

    let count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) AS "count!"
        FROM comms_entity_mentions
        WHERE source_entity_id = $1 AND entity_id = $2
        "#,
        "doc-2",
        "user-y",
    )
    .fetch_one(&repo.pool)
    .await?;
    assert_eq!(count, 2);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_entity_mention_by_id_returns_none_when_missing(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    assert!(
        repo.get_entity_mention_by_id(Uuid::new_v4())
            .await?
            .is_none()
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_entity_mention_by_id_removes_only_targeted_row(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let target = repo
        .create_entity_mention(mention_opts("doc-3", "user", "user-z", None))
        .await?;
    let other = repo
        .create_entity_mention(mention_opts("doc-3", "user", "user-w", None))
        .await?;

    let deleted = repo
        .delete_entity_mention_by_id(target.id)
        .await?
        .expect("deleted row should be returned");
    assert_eq!(deleted.id, target.id);
    assert!(repo.get_entity_mention_by_id(target.id).await?.is_none());
    assert!(repo.get_entity_mention_by_id(other.id).await?.is_some());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_entity_mention_by_id_returns_none_when_missing(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    assert!(
        repo.delete_entity_mention_by_id(Uuid::new_v4())
            .await?
            .is_none()
    );
    Ok(())
}

// --- get_attachment_references ---
//
// The query is a byte-identical port of comms_db_client::get_attachment_references;
// these cover the three source paths (direct attachment, message mention, generic
// mention), participation gating, deleted-message exclusion, and the merged sort —
// rather than re-porting the full original suite.

fn channel_refs(
    refs: &[AttachmentEntityReference],
) -> Vec<&crate::domain::models::AttachmentChannelReference> {
    refs.iter()
        .filter_map(|r| match r {
            AttachmentEntityReference::Channel(c) => Some(c),
            AttachmentEntityReference::Generic(_) => None,
        })
        .collect()
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn attachment_references_returns_channel_reference_for_participant(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let refs = repo(pool)
        .get_attachment_references("document", "doc-1", USER_A)
        .await?;

    assert_eq!(refs.len(), 1);
    let channel = channel_refs(&refs);
    assert_eq!(channel.len(), 1);
    assert_eq!(channel[0].channel_id, CH1);
    assert_eq!(channel[0].message_id, MSG1);
    assert_eq!(channel[0].message_content, "first message");
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channels_repo"))
)]
async fn batch_preview_omits_missing_channels(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let missing = Uuid::from_u128(0x00000000_0000_0000_0000_0000000099ff);
    let rows = repo(pool)
        .batch_get_channel_previews(&[CH1.to_string(), missing.to_string()], USER_A, None)
        .await?;

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].info.id, CH1);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn attachment_references_hidden_from_non_and_former_participants(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);

    // user never in the channel
    let refs = repo
        .get_attachment_references("document", "doc-1", NON_MEMBER)
        .await?;
    assert!(refs.is_empty());

    // user who left the channel (left_at IS NOT NULL)
    let refs = repo
        .get_attachment_references("document", "doc-1", LEFT_USER)
        .await?;
    assert!(refs.is_empty());
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn attachment_references_excludes_deleted_message(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // img-deleted is attached to msg2, which is soft-deleted.
    let refs = repo(pool)
        .get_attachment_references("image", "img-deleted", USER_A)
        .await?;
    assert!(refs.is_empty());
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn attachment_references_returns_message_mention(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // doc-mention is mentioned inside msg3 (source_entity_type = 'message').
    let refs = repo(pool)
        .get_attachment_references("document", "doc-mention", USER_A)
        .await?;

    assert_eq!(refs.len(), 1);
    let channel = channel_refs(&refs);
    assert_eq!(channel.len(), 1);
    assert_eq!(channel[0].channel_id, CH1);
    assert_eq!(channel[0].message_id, MSG3);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn attachment_references_returns_generic_reference(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // doc-generic is mentioned by a non-message source; generic refs are not gated
    // by channel participation, so any user resolves them.
    let refs = repo(pool)
        .get_attachment_references("document", "doc-generic", NON_MEMBER)
        .await?;

    assert_eq!(refs.len(), 1);
    let AttachmentEntityReference::Generic(generic) = &refs[0] else {
        anyhow::bail!("expected a generic reference");
    };
    assert_eq!(generic.source_entity_type, "doc");
    assert_eq!(generic.source_entity_id, "src-doc");
    assert_eq!(generic.entity_id, "doc-generic");
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn attachment_references_merges_channel_and_generic_newest_first(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // doc-2 has a direct attachment on msg3 (12:00) and a newer generic mention
    // (2024-01-04); the merged result must be sorted newest-first.
    let refs = repo(pool)
        .get_attachment_references("document", "doc-2", USER_A)
        .await?;

    assert_eq!(refs.len(), 2);
    assert!(
        matches!(refs[0], AttachmentEntityReference::Generic(_)),
        "newer generic reference should come first"
    );
    assert!(
        matches!(refs[1], AttachmentEntityReference::Channel(_)),
        "older channel reference should come second"
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn attachment_references_treats_email_alias_as_thread(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // Share-menu attachments historically stored entity_type = 'email'.
    // Referencium queries 'thread', so the lookup must accept both.
    sqlx::query(
        r#"
        INSERT INTO comms_attachments (id, message_id, channel_id, entity_type, entity_id, width, height, created_at)
        VALUES (
            '00000000-0000-0000-0000-00000000a0e1',
            '00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000c01',
            'email',
            'email-share-1',
            NULL,
            NULL,
            '2024-01-01 10:05:00+00'
        )
        "#,
    )
    .execute(&pool)
    .await?;

    let repo = repo(pool);
    let by_thread = repo
        .get_attachment_references("thread", "email-share-1", USER_A)
        .await?;
    let by_email = repo
        .get_attachment_references("email", "email-share-1", USER_A)
        .await?;

    assert_eq!(channel_refs(&by_thread).len(), 1);
    assert_eq!(channel_refs(&by_email).len(), 1);
    assert_eq!(channel_refs(&by_thread)[0].message_id, MSG1);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn add_attachments_normalizes_email_to_thread(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let inserted = repo(pool)
        .add_attachments(
            MSG1,
            CH1,
            vec![NewChannelAttachment {
                entity_type: "email".to_string(),
                entity_id: "email-norm-1".to_string(),
                width: None,
                height: None,
            }],
        )
        .await?;

    assert_eq!(inserted.len(), 1);
    assert_eq!(inserted[0].entity_type, "thread");
    assert_eq!(inserted[0].entity_id, "email-norm-1");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bot_profiles_includes_soft_deleted_bots(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let active = Uuid::new_v4();
    let deleted = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO bots (id, kind, owner_user_id, name, handle, avatar_url, deleted_at)
        VALUES
            ($1, 'owned', $3, 'Active Bot', 'active-bot', 'https://example.com/a.png', NULL),
            ($2, 'owned', $3, 'Deleted Bot', 'deleted-bot', NULL, now())
        "#,
    )
    .bind(active)
    .bind(deleted)
    .bind(USER_A)
    .execute(&pool)
    .await?;

    let missing = BotId::new_from_uuid(Uuid::new_v4());
    let profiles = repo(pool)
        .get_bot_profiles(&[
            BotId::new_from_uuid(active),
            BotId::new_from_uuid(deleted),
            missing,
        ])
        .await?;

    assert_eq!(profiles.len(), 2);
    assert_eq!(
        profiles.get(&BotId::new_from_uuid(active)),
        Some(&BotSenderProfile {
            name: "Active Bot".to_string(),
            avatar_url: Some("https://example.com/a.png".to_string()),
        })
    );
    assert_eq!(
        profiles.get(&BotId::new_from_uuid(deleted)),
        Some(&BotSenderProfile {
            name: "Deleted Bot".to_string(),
            avatar_url: None,
        })
    );
    assert!(!profiles.contains_key(&missing));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_channel_cascades_contacts_backfill_outbox_rows(pool: Pool<Postgres>) {
    let repo = repo(pool.clone());
    let created = repo
        .create_channel(
            macro_user_id(USER_A),
            None,
            CreateChannelRequest {
                name: Some("delete-with-outbox".to_string()),
                channel_type: ChannelType::Private,
                team_id: None,
                auto_join_team: false,
                participants: HashSet::new(),
            },
        )
        .await
        .unwrap();

    sqlx::query!(
        "INSERT INTO contacts_backfill_outbox (comms_channel_id, user_ids) \
         VALUES ($1, '[\"macro|user-a@test.com\"]'::jsonb)",
        created.id,
    )
    .execute(&pool)
    .await
    .unwrap();

    repo.delete_channel(created.id, USER_A.to_string())
        .await
        .expect("channel delete must succeed when contacts_backfill_outbox references the channel");

    let channel_count = sqlx::query_scalar!(
        "SELECT count(*) FROM comms_channels WHERE id = $1",
        created.id,
    )
    .fetch_one(&pool)
    .await
    .unwrap()
    .unwrap();
    assert_eq!(channel_count, 0);

    let outbox_count = sqlx::query_scalar!(
        "SELECT count(*) FROM contacts_backfill_outbox WHERE comms_channel_id = $1",
        created.id,
    )
    .fetch_one(&pool)
    .await
    .unwrap()
    .unwrap();
    assert_eq!(outbox_count, 0);
}
