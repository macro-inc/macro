use super::*;
use crate::domain::channel_settings::ChannelNotificationKind::{
    CallStarted, Mention, Reaction, ThreadReply, TopLevelMessage,
};
use chrono::Duration;
use cowlike::CowLike;
use strum::IntoEnumIterator;

const LABEL_A: Uuid = Uuid::from_u128(0xa);
const LABEL_B: Uuid = Uuid::from_u128(0xb);
const A: ChannelSection = ChannelSection::Label { label_id: LABEL_A };
const B: ChannelSection = ChannelSection::Label { label_id: LABEL_B };

fn alice() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|alice@example.com").unwrap()
}

fn allowing_only(kinds: &[ChannelNotificationKind]) -> SectionNotificationSettings {
    SectionNotificationSettings {
        disabled: ChannelNotificationKind::iter()
            .filter(|kind| !kinds.contains(kind))
            .collect(),
        mute: SectionMute::Unmuted,
    }
}

fn muted() -> SectionNotificationSettings {
    SectionNotificationSettings {
        disabled: BTreeSet::new(),
        mute: SectionMute::Muted,
    }
}

fn delivery(
    kind: ChannelNotificationKind,
    channel: Option<&ChannelNotificationSettings>,
    sections: &[ChannelSection],
    settings: &[(ChannelSection, SectionNotificationSettings)],
) -> ChannelDelivery {
    channel_delivery(
        Some(kind),
        channel,
        sections,
        &settings.iter().cloned().collect(),
        Utc::now(),
    )
}

#[test]
fn a_channel_receives_a_kind_any_of_its_sections_allows() {
    let settings = [
        (A, allowing_only(&[Mention])),
        (B, allowing_only(&[ThreadReply])),
    ];

    assert_eq!(
        delivery(Mention, None, &[A, B], &settings),
        ChannelDelivery::Receive
    );
    assert_eq!(
        delivery(ThreadReply, None, &[A, B], &settings),
        ChannelDelivery::Receive
    );
    assert_eq!(
        delivery(TopLevelMessage, None, &[A, B], &settings),
        ChannelDelivery::TurnedOff
    );
}

#[test]
fn an_untouched_section_allows_everything() {
    let settings = [(A, allowing_only(&[Mention]))];

    assert_eq!(
        delivery(TopLevelMessage, None, &[A], &settings),
        ChannelDelivery::TurnedOff
    );
    assert_eq!(
        delivery(
            TopLevelMessage,
            None,
            &[A, ChannelSection::Favorites],
            &settings
        ),
        ChannelDelivery::Receive
    );
    assert_eq!(
        delivery(TopLevelMessage, None, &[], &settings),
        ChannelDelivery::Receive
    );
}

#[test]
fn a_channel_with_its_own_settings_ignores_its_sections_kinds() {
    let settings = [(A, allowing_only(&[Mention]))];
    let channel = ChannelNotificationSettings {
        enabled: Some(BTreeSet::from([TopLevelMessage])),
        overrides_section_mute: false,
    };

    assert_eq!(
        delivery(TopLevelMessage, Some(&channel), &[A], &settings),
        ChannelDelivery::Receive
    );
    // Off on the channel although its section allows it.
    assert_eq!(
        delivery(Mention, Some(&channel), &[A], &settings),
        ChannelDelivery::TurnedOff
    );
    // Off on the channel, as everywhere a channel's own set leaves a kind out.
    assert_eq!(
        delivery(Reaction, Some(&channel), &[], &[]),
        ChannelDelivery::TurnedOff
    );

    // Only a section mute override follows its sections' kinds.
    let overridden = ChannelNotificationSettings {
        overrides_section_mute: true,
        ..Default::default()
    };
    assert_eq!(
        delivery(Reaction, Some(&overridden), &[A], &settings),
        ChannelDelivery::TurnedOff
    );
}

#[test]
fn sections_mute_a_channel_only_when_all_are_muted() {
    assert_eq!(
        delivery(Mention, None, &[A, B], &[(A, muted())]),
        ChannelDelivery::Receive
    );
    assert_eq!(
        delivery(Mention, None, &[A, B], &[(A, muted()), (B, muted())]),
        ChannelDelivery::MutedBySections
    );

    let overridden = ChannelNotificationSettings {
        overrides_section_mute: true,
        ..Default::default()
    };
    assert_eq!(
        delivery(Mention, Some(&overridden), &[A], &[(A, muted())]),
        ChannelDelivery::Receive
    );

    // A section mute stops even notifications no setting controls.
    assert_eq!(
        channel_delivery(
            None,
            None,
            &[A],
            &BTreeMap::from([(A, muted())]),
            Utc::now()
        ),
        ChannelDelivery::MutedBySections
    );
}

#[test]
fn an_ended_snooze_no_longer_mutes() {
    let now = Utc::now();
    let snoozed = |until| SectionNotificationSettings {
        disabled: BTreeSet::new(),
        mute: SectionMute::Snoozed { until },
    };

    let ended = BTreeMap::from([(A, snoozed(now - Duration::minutes(1)))]);
    assert_eq!(
        channel_delivery(Some(CallStarted), None, &[A], &ended, now),
        ChannelDelivery::Receive
    );

    let running = BTreeMap::from([(A, snoozed(now + Duration::minutes(1)))]);
    assert_eq!(
        channel_delivery(Some(CallStarted), None, &[A], &running, now),
        ChannelDelivery::MutedBySections
    );
}

#[test]
fn a_built_in_section_holds_only_channels_outside_custom_sections() {
    let unsectioned = test_user("unsectioned");
    let sectioned = test_user("sectioned");
    let membership = ChannelSectionMembership {
        built_in: Some(ChannelSection::TeamChannels),
        labels: HashMap::from([(sectioned.clone(), vec![LABEL_A, LABEL_B])]),
        favorites: HashSet::from([unsectioned.clone()]),
    };

    assert_eq!(
        membership.sections_for(&unsectioned),
        vec![ChannelSection::TeamChannels, ChannelSection::Favorites]
    );
    assert_eq!(membership.sections_for(&sectioned), vec![A, B]);

    let all_channels = ChannelSectionMembership::default();
    assert!(all_channels.sections_for(&alice()).is_empty());
}

fn test_user(name: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(&format!("macro|{name}@example.com"))
        .unwrap()
        .into_owned()
}

struct FakeRepository;

impl SectionNotificationSettingsRepository for FakeRepository {
    async fn list(
        &self,
        _user: MacroUserIdStr<'_>,
        _now: DateTime<Utc>,
    ) -> Result<BTreeMap<ChannelSection, SectionNotificationSettings>, Report> {
        Ok(BTreeMap::new())
    }

    async fn update(
        &self,
        _user: MacroUserIdStr<'_>,
        _section: ChannelSection,
        change: &SectionNotificationSettingsChange,
    ) -> Result<SectionNotificationSettings, SectionSettingsWriteError> {
        Ok(SectionNotificationSettings {
            disabled: change.disable.clone(),
            mute: change.mute.unwrap_or_default(),
        })
    }
}

#[tokio::test]
async fn rejects_empty_conflicting_and_past_changes() {
    let service = SectionNotificationSettingsService::new(FakeRepository);
    let now = Utc::now();

    let empty = service
        .update(
            alice(),
            A,
            SectionNotificationSettingsChange::default(),
            now,
        )
        .await;
    assert!(matches!(
        empty,
        Err(SectionNotificationSettingsError::EmptyChange)
    ));

    let conflicting = service
        .update(
            alice(),
            A,
            SectionNotificationSettingsChange {
                enable: BTreeSet::from([Mention]),
                disable: BTreeSet::from([Mention]),
                mute: None,
            },
            now,
        )
        .await;
    assert!(matches!(
        conflicting,
        Err(SectionNotificationSettingsError::ConflictingChange)
    ));

    let past = service
        .update(
            alice(),
            A,
            SectionNotificationSettingsChange {
                mute: Some(SectionMute::Snoozed {
                    until: now - Duration::minutes(1),
                }),
                ..Default::default()
            },
            now,
        )
        .await;
    assert!(matches!(
        past,
        Err(SectionNotificationSettingsError::InvalidDeadline)
    ));
}
