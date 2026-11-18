use super::*;
use crate::domain::channel_settings::ChannelNotificationKind::{
    CallStarted, Mention, Reaction, ThreadReply, TopLevelMessage,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const GENERAL: Uuid = Uuid::from_u128(0x61000000_0000_0000_0000_000000000001);
const RANDOM: Uuid = Uuid::from_u128(0x61000000_0000_0000_0000_000000000002);

fn user(name: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(&format!("macro|{name}@example.com"))
        .unwrap()
        .into_owned()
}

fn disable(kinds: &[ChannelNotificationKind]) -> ChannelNotificationSettingsChange {
    ChannelNotificationSettingsChange {
        disable: kinds.iter().copied().collect(),
        ..Default::default()
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channel_notification_settings"))
)]
async fn changes_move_kinds_between_on_off_and_inherited(pool: PgPool) {
    let repo = PgChannelNotificationSettingsRepository(pool.clone());

    let updated = repo
        .update(
            user("alice"),
            GENERAL,
            &disable(&[TopLevelMessage, ThreadReply]),
        )
        .await
        .unwrap();
    assert_eq!(
        updated.disabled,
        BTreeSet::from([TopLevelMessage, ThreadReply])
    );

    // Turning a kind on moves it out of the disabled list; kinds the change
    // does not name keep their choice.
    let updated = repo
        .update(
            user("alice"),
            GENERAL,
            &ChannelNotificationSettingsChange {
                enable: BTreeSet::from([ThreadReply]),
                disable: BTreeSet::from([Reaction]),
                overrides_section_mute: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(
        updated,
        ChannelNotificationSettings {
            disabled: BTreeSet::from([TopLevelMessage, Reaction]),
            enabled: BTreeSet::from([ThreadReply]),
            overrides_section_mute: true,
        }
    );
    assert_eq!(
        repo.list(user("alice")).await.unwrap(),
        BTreeMap::from([(GENERAL, updated)])
    );

    // Handing every kind back to the sections and clearing the override
    // leaves no settings, so the row goes.
    let updated = repo
        .update(
            user("alice"),
            GENERAL,
            &ChannelNotificationSettingsChange {
                inherit: BTreeSet::from([TopLevelMessage, ThreadReply, Reaction]),
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
                inherit: BTreeSet::from([Mention]),
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
async fn unknown_channel_is_rejected(pool: PgPool) {
    let repo = PgChannelNotificationSettingsRepository(pool);

    let result = repo
        .update(user("alice"), Uuid::nil(), &disable(&[Mention]))
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
    repo.update(user("alice"), GENERAL, &disable(&[Mention]))
        .await
        .unwrap();
    repo.update(user("alice"), RANDOM, &disable(&[CallStarted]))
        .await
        .unwrap();
    repo.update(user("bob"), RANDOM, &disable(&[TopLevelMessage]))
        .await
        .unwrap();

    let general = settings_for_recipients(&pool, GENERAL, &[user("alice"), user("bob")])
        .await
        .unwrap();
    assert_eq!(general.keys().collect::<Vec<_>>(), vec![&user("alice")]);
    assert_eq!(general[&user("alice")].disabled, BTreeSet::from([Mention]));

    let random = settings_for_recipients(&pool, RANDOM, &[user("bob")])
        .await
        .unwrap();
    assert_eq!(random.keys().collect::<Vec<_>>(), vec![&user("bob")]);
    assert_eq!(
        random[&user("bob")].disabled,
        BTreeSet::from([TopLevelMessage])
    );

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
