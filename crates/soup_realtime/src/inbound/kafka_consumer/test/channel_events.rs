use channels::domain::broker_events::ChannelMacroEvent;
use model_entity::Entity;

use super::*;
use crate::domain::{
    models::{SharedAccess, SoupRealtimeMessage},
    ports::{SoupRealtimePublisher, UserAccessExpander},
};

/// Gives every entity the same current accessors.
struct FixedAccess(Vec<MacroUserIdStr<'static>>);

impl UserAccessExpander for FixedAccess {
    async fn expand_user_access(
        &self,
        entities: &[Entity<'static>],
    ) -> Result<Vec<SharedAccess>, Report> {
        Ok(vec![SharedAccess {
            entities: entities.to_vec(),
            users: self.0.clone(),
        }])
    }
}

struct RecordingPublisher(Arc<Mutex<Vec<SoupRealtimeMessage>>>);

impl SoupRealtimePublisher for RecordingPublisher {
    async fn publish(&self, message: SoupRealtimeMessage) -> Result<(), Report> {
        self.0.lock().expect("messages lock").push(message);
        Ok(())
    }
}

fn person(name: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{name}@example.com")).expect("valid user id")
}

/// A removal consumed after one of the removed was added back: that one is a
/// current accessor again and must keep the channel.
#[tokio::test]
async fn a_member_added_back_before_their_removal_is_consumed_keeps_the_channel() {
    let channel_id = Uuid::now_v7();
    let channel = EntityType::Channel.with_entity_string(channel_id.to_string());
    for channel_type in [ChannelType::Private, ChannelType::DirectMessage] {
        let published = Arc::new(Mutex::new(Vec::new()));
        let service = SoupRealtimeServiceImpl::new(
            FixedAccess(vec![person("member"), person("back")]),
            RecordingPublisher(published.clone()),
        );
        let event = DeclaredMacroEvent::ChannelMacroEvent(ChannelMacroEvent::participant_removed(
            ChannelParticipantRemovedMetadata {
                channel_id,
                channel_type,
                removed_by: user(),
                removed_user_ids: vec![person("back"), person("gone")],
            },
        ));

        let outcome = process_event(&service, &NoPullRequestSessions, &event, || {}).await;

        assert!(
            matches!(outcome, EventOutcome::Notified),
            "{channel_type:?}"
        );
        let mut messages: Vec<_> = published
            .lock()
            .expect("messages lock")
            .iter()
            .map(|message| (message.user_id.to_string(), message.patch.clone()))
            .collect();
        messages.sort_by_key(|(user_id, patch)| (user_id.clone(), format!("{patch:?}")));
        assert_eq!(
            messages,
            vec![
                (person("back").to_string(), Patch::Updated(channel.clone())),
                (person("gone").to_string(), Patch::Deleted(channel.clone())),
                (
                    person("member").to_string(),
                    Patch::Updated(channel.clone())
                ),
            ],
            "{channel_type:?}"
        );
    }
}
