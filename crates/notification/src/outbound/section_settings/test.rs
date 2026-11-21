use super::*;
use crate::domain::channel_settings::ChannelNotificationKind::{
    Mention, Reaction, TopLevelMessage,
};
use chrono::Duration;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use std::collections::BTreeSet;

const PROJECTS: ChannelSection = ChannelSection::Label {
    label_id: Uuid::from_u128(0x62000000_0000_0000_0000_000000000001),
};

fn user(name: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(&format!("macro|{name}@example.com"))
        .unwrap()
        .into_owned()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("section_notification_settings"))
)]
async fn changes_merge_and_clearing_everything_deletes_the_row(pool: PgPool) {
    let repo = PgSectionNotificationSettingsRepository(pool.clone());
    let now = Utc::now();

    repo.update(
        user("alice"),
        PROJECTS,
        &SectionNotificationSettingsChange {
            disable: BTreeSet::from([TopLevelMessage, Reaction]),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let until = now + Duration::hours(1);
    let updated = repo
        .update(
            user("alice"),
            PROJECTS,
            &SectionNotificationSettingsChange {
                enable: BTreeSet::from([Reaction]),
                mute: Some(SectionMute::Snoozed { until }),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(updated.disabled, BTreeSet::from([TopLevelMessage]));
    assert!(matches!(updated.mute, SectionMute::Snoozed { .. }));

    // A kinds-only change keeps the mute.
    repo.update(
        user("alice"),
        ChannelSection::Favorites,
        &SectionNotificationSettingsChange {
            disable: BTreeSet::from([Mention]),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let listed = repo.list(user("alice"), now).await.unwrap();
    assert_eq!(listed.len(), 2);
    assert!(matches!(
        listed[&PROJECTS].mute,
        SectionMute::Snoozed { .. }
    ));
    assert_eq!(
        listed[&ChannelSection::Favorites].disabled,
        BTreeSet::from([Mention])
    );

    // An ended snooze lists as unmuted.
    let later = repo
        .list(user("alice"), until + Duration::minutes(1))
        .await
        .unwrap();
    assert_eq!(later[&PROJECTS].mute, SectionMute::Unmuted);

    let updated = repo
        .update(
            user("alice"),
            PROJECTS,
            &SectionNotificationSettingsChange {
                enable: BTreeSet::from([TopLevelMessage]),
                mute: Some(SectionMute::Unmuted),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert!(updated.is_empty());
    let listed = repo.list(user("alice"), now).await.unwrap();
    assert_eq!(
        listed.keys().collect::<Vec<_>>(),
        vec![&ChannelSection::Favorites]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("section_notification_settings"))
)]
async fn unknown_custom_section_is_rejected(pool: PgPool) {
    let repo = PgSectionNotificationSettingsRepository(pool);

    let result = repo
        .update(
            user("alice"),
            ChannelSection::Label {
                label_id: Uuid::nil(),
            },
            &SectionNotificationSettingsChange {
                mute: Some(SectionMute::Muted),
                ..Default::default()
            },
        )
        .await;

    assert!(matches!(
        result,
        Err(SectionSettingsWriteError::UnknownSection)
    ));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("section_notification_settings"))
)]
async fn ingress_reads_the_settings_of_the_users_asked_for(pool: PgPool) {
    let repo = PgSectionNotificationSettingsRepository(pool.clone());
    let mute = SectionNotificationSettingsChange {
        mute: Some(SectionMute::Muted),
        ..Default::default()
    };
    repo.update(user("alice"), PROJECTS, &mute).await.unwrap();
    repo.update(user("bob"), ChannelSection::DirectMessages, &mute)
        .await
        .unwrap();

    let settings = section_settings_for_recipients(&pool, &[user("alice")])
        .await
        .unwrap();

    assert_eq!(settings.keys().collect::<Vec<_>>(), vec![&user("alice")]);
    assert_eq!(settings[&user("alice")][&PROJECTS].mute, SectionMute::Muted);

    // Deleting the section removes its settings.
    sqlx::query!("DELETE FROM channel_label")
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        repo.list(user("alice"), Utc::now())
            .await
            .unwrap()
            .is_empty()
    );
}
