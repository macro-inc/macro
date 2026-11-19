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
        let enabled = match &change.kinds {
            ChannelKindsChange::Set(kinds) => Some(kinds.clone()),
            ChannelKindsChange::Keep | ChannelKindsChange::Inherit => None,
        };
        Ok(ChannelNotificationSettings {
            enabled,
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
async fn rejects_a_change_that_does_nothing() {
    let service = ChannelNotificationSettingsService::new(FakeRepository::default());

    let empty = service
        .update(
            alice(),
            Uuid::now_v7(),
            ChannelNotificationSettingsChange::default(),
        )
        .await;

    assert!(matches!(
        empty,
        Err(ChannelNotificationSettingsError::EmptyChange)
    ));
    assert!(service.repository.updates.lock().unwrap().is_empty());
}

#[tokio::test]
async fn passes_a_full_set_of_kinds_to_the_repository() {
    let service = ChannelNotificationSettingsService::new(FakeRepository::default());
    let kinds = BTreeSet::from([ChannelNotificationKind::ThreadReply]);

    let updated = service
        .update(
            alice(),
            Uuid::now_v7(),
            ChannelNotificationSettingsChange {
                kinds: ChannelKindsChange::Set(kinds.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    assert_eq!(updated.enabled, Some(kinds));
    assert_eq!(service.repository.updates.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn inheriting_alone_is_a_change() {
    let service = ChannelNotificationSettingsService::new(FakeRepository::default());

    let updated = service
        .update(
            alice(),
            Uuid::now_v7(),
            ChannelNotificationSettingsChange {
                kinds: ChannelKindsChange::Inherit,
                ..Default::default()
            },
        )
        .await
        .unwrap();

    assert!(updated.is_empty());
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
