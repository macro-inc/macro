use super::*;
use crate::domain::channel_settings::ChannelNotificationKind::{
    CallStarted, JoinRequest, Mention, Reaction, ThreadReply, TopLevelMessage,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const GENERAL: Uuid = Uuid::from_u128(0x61000000_0000_0000_0000_000000000001);
const RANDOM: Uuid = Uuid::from_u128(0x61000000_0000_0000_0000_000000000002);

fn user(name: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(&format!("macro|{name}@example.com"))
        .unwrap()
        .into_owned()
}

fn set(kinds: &[ChannelNotificationKind]) -> ChannelNotificationSettingsChange {
    ChannelNotificationSettingsChange {
        kinds: ChannelKindsChange::Set(kinds.iter().copied().collect()),
        ..Default::default()
    }
}

fn kinds(kinds: &[ChannelNotificationKind]) -> Option<BTreeSet<ChannelNotificationKind>> {
    Some(kinds.iter().copied().collect())
}

async fn mark_mentions_only(pool: &PgPool, user: &MacroUserIdStr<'_>, channel_id: Uuid) {
    sqlx::query!(
        r#"INSERT INTO user_notification_item_unsubscribe (user_id, item_id, item_type, mentions_only)
           VALUES ($1, $2, 'channel', TRUE)"#,
        user.as_ref(),
        channel_id.to_string()
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn mentions_only_rows(pool: &PgPool) -> i64 {
    sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM user_notification_item_unsubscribe WHERE mentions_only"#
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channel_notification_settings"))
)]
async fn a_channel_has_its_own_full_set_or_follows_its_sections(pool: PgPool) {
    let repo = PgChannelNotificationSettingsRepository(pool.clone());

    let updated = repo
        .update(user("alice"), GENERAL, &set(&[ThreadReply, Mention]))
        .await
        .unwrap();
    assert_eq!(updated.enabled, kinds(&[ThreadReply, Mention]));

    // The table keeps the kinds turned off, so kinds added later are on.
    let stored =
        sqlx::query_scalar!("SELECT disabled_event_types FROM user_channel_notification_setting")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        stored,
        Some(event_types(&BTreeSet::from([
            TopLevelMessage,
            Reaction,
            CallStarted,
            JoinRequest
        ])))
    );

    // An override change keeps the kinds; a new set replaces them whole.
    let updated = repo
        .update(
            user("alice"),
            GENERAL,
            &ChannelNotificationSettingsChange {
                overrides_section_mute: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(updated.enabled, kinds(&[ThreadReply, Mention]));
    let updated = repo
        .update(user("alice"), GENERAL, &set(&[Reaction]))
        .await
        .unwrap();
    assert_eq!(
        updated,
        ChannelNotificationSettings {
            enabled: kinds(&[Reaction]),
            overrides_section_mute: true,
        }
    );
    assert_eq!(
        repo.list(user("alice")).await.unwrap(),
        BTreeMap::from([(GENERAL, updated)])
    );

    // Inheriting keeps the override, and clearing it too leaves no row.
    let updated = repo
        .update(
            user("alice"),
            GENERAL,
            &ChannelNotificationSettingsChange {
                kinds: ChannelKindsChange::Inherit,
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(updated.enabled, None);
    assert!(updated.overrides_section_mute);
    let updated = repo
        .update(
            user("alice"),
            GENERAL,
            &ChannelNotificationSettingsChange {
                overrides_section_mute: Some(false),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert!(updated.is_empty());
    assert!(repo.list(user("alice")).await.unwrap().is_empty());
    let rows = sqlx::query_scalar!("SELECT COUNT(*) FROM user_channel_notification_setting")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(rows, Some(0));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channel_notification_settings"))
)]
async fn inheriting_on_a_channel_without_settings_stores_nothing(pool: PgPool) {
    let repo = PgChannelNotificationSettingsRepository(pool);

    let updated = repo
        .update(
            user("alice"),
            GENERAL,
            &ChannelNotificationSettingsChange {
                kinds: ChannelKindsChange::Inherit,
                ..Default::default()
            },
        )
        .await
        .unwrap();

    assert!(updated.is_empty());
    assert!(repo.list(user("alice")).await.unwrap().is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channel_notification_settings"))
)]
async fn changing_kinds_replaces_a_legacy_mentions_only_preference(pool: PgPool) {
    let repo = PgChannelNotificationSettingsRepository(pool.clone());
    mark_mentions_only(&pool, &user("alice"), GENERAL).await;
    mark_mentions_only(&pool, &user("alice"), RANDOM).await;
    mark_mentions_only(&pool, &user("bob"), GENERAL).await;

    // An override change alone keeps it.
    repo.update(
        user("alice"),
        GENERAL,
        &ChannelNotificationSettingsChange {
            overrides_section_mute: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(mentions_only_rows(&pool).await, 3);

    repo.update(user("alice"), GENERAL, &set(&[Mention]))
        .await
        .unwrap();
    assert_eq!(mentions_only_rows(&pool).await, 2);

    repo.reset(user("alice"), RANDOM).await.unwrap();
    assert_eq!(mentions_only_rows(&pool).await, 1);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channel_notification_settings"))
)]
async fn unknown_channel_is_rejected(pool: PgPool) {
    let repo = PgChannelNotificationSettingsRepository(pool);

    let result = repo
        .update(user("alice"), Uuid::nil(), &set(&[Mention]))
        .await;

    assert!(matches!(
        result,
        Err(ChannelSettingsWriteError::UnknownChannel)
    ));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channel_notification_settings"))
)]
async fn ingress_reads_only_the_channel_and_users_asked_for(pool: PgPool) {
    let repo = PgChannelNotificationSettingsRepository(pool.clone());
    repo.update(user("alice"), GENERAL, &set(&[Mention]))
        .await
        .unwrap();
    repo.update(user("alice"), RANDOM, &set(&[CallStarted]))
        .await
        .unwrap();
    repo.update(user("bob"), RANDOM, &set(&[TopLevelMessage]))
        .await
        .unwrap();

    let general = settings_for_recipients(&pool, GENERAL, &[user("alice"), user("bob")])
        .await
        .unwrap();
    assert_eq!(general.keys().collect::<Vec<_>>(), vec![&user("alice")]);
    assert_eq!(general[&user("alice")].enabled, kinds(&[Mention]));

    let random = settings_for_recipients(&pool, RANDOM, &[user("bob")])
        .await
        .unwrap();
    assert_eq!(random.keys().collect::<Vec<_>>(), vec![&user("bob")]);
    assert_eq!(random[&user("bob")].enabled, kinds(&[TopLevelMessage]));

    repo.reset(user("alice"), RANDOM).await.unwrap();
    assert_eq!(
        repo.list(user("alice"))
            .await
            .unwrap()
            .into_keys()
            .collect::<Vec<_>>(),
        vec![GENERAL]
    );
}
