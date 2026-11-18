use super::*;
use std::sync::Mutex;

#[derive(Default)]
struct FakeRepository {
    updates: Mutex<Vec<(Uuid, ChannelNotificationSettingsChange)>>,
}

impl ChannelNotificationSettingsRepository for FakeRepository {
    async fn list(
        &self,
        _user: MacroUserIdStr<'_>,
    ) -> Result<BTreeMap<Uuid, ChannelNotificationSettings>, Report> {
        Ok(BTreeMap::new())
    }

    async fn update(
        &self,
        _user: MacroUserIdStr<'_>,
        channel_id: Uuid,
        change: &ChannelNotificationSettingsChange,
    ) -> Result<ChannelNotificationSettings, ChannelSettingsWriteError> {
        self.updates
            .lock()
            .unwrap()
            .push((channel_id, change.clone()));
        Ok(ChannelNotificationSettings {
            disabled: change.disable.clone(),
            enabled: change.enable.clone(),
            overrides_section_mute: change.overrides_section_mute.unwrap_or_default(),
        })
    }

    async fn reset(&self, _user: MacroUserIdStr<'_>, _channel_id: Uuid) -> Result<(), Report> {
        Ok(())
    }
}

fn alice() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|alice@example.com").unwrap()
}

#[tokio::test]
async fn rejects_changes_that_do_nothing_or_contradict_themselves() {
    let service = ChannelNotificationSettingsService::new(FakeRepository::default());
    let channel_id = Uuid::now_v7();

    let empty = service
        .update(
            alice(),
            channel_id,
            ChannelNotificationSettingsChange::default(),
        )
        .await;
    assert!(matches!(
        empty,
        Err(ChannelNotificationSettingsError::EmptyChange)
    ));

    let conflicting = service
        .update(
            alice(),
            channel_id,
            ChannelNotificationSettingsChange {
                enable: BTreeSet::from([ChannelNotificationKind::Reaction]),
                disable: BTreeSet::from([
                    ChannelNotificationKind::Reaction,
                    ChannelNotificationKind::Mention,
                ]),
                ..Default::default()
            },
        )
        .await;
    assert!(matches!(
        conflicting,
        Err(ChannelNotificationSettingsError::ConflictingChange)
    ));

    let inherited_and_disabled = service
        .update(
            alice(),
            channel_id,
            ChannelNotificationSettingsChange {
                disable: BTreeSet::from([ChannelNotificationKind::Mention]),
                inherit: BTreeSet::from([ChannelNotificationKind::Mention]),
                ..Default::default()
            },
        )
        .await;
    assert!(matches!(
        inherited_and_disabled,
        Err(ChannelNotificationSettingsError::ConflictingChange)
    ));

    assert!(service.repository.updates.lock().unwrap().is_empty());
}

#[tokio::test]
async fn passes_a_valid_change_to_the_repository() {
    let service = ChannelNotificationSettingsService::new(FakeRepository::default());
    let channel_id = Uuid::now_v7();

    let updated = service
        .update(
            alice(),
            channel_id,
            ChannelNotificationSettingsChange {
                enable: BTreeSet::from([ChannelNotificationKind::ThreadReply]),
                disable: BTreeSet::from([ChannelNotificationKind::CallStarted]),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    assert_eq!(
        updated.disabled,
        BTreeSet::from([ChannelNotificationKind::CallStarted])
    );
    assert_eq!(service.repository.updates.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn an_override_change_alone_is_a_change() {
    let service = ChannelNotificationSettingsService::new(FakeRepository::default());

    let updated = service
        .update(
            alice(),
            Uuid::now_v7(),
            ChannelNotificationSettingsChange {
                overrides_section_mute: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    assert!(updated.overrides_section_mute);
}
