use channels::domain::broker_events::{ChannelMacroEvent, ChannelParticipantAddedMetadata};
use model_entity::Entity;

use super::*;
use crate::domain::{
    models::{SharedAccess, SoupRealtimeMessage},
    ports::{SoupRealtimePublisher, UserAccessExpander},
};

/// A channel roster as the audience cache holds it, which can predate the
/// event being consumed, and as the database holds it now.
struct CachedRoster {
    cached: Vec<MacroUserIdStr<'static>>,
    current: Vec<MacroUserIdStr<'static>>,
    cached_lookups: Arc<AtomicUsize>,
    current_reads: Arc<AtomicUsize>,
}

impl UserAccessExpander for CachedRoster {
    async fn expand_user_access(
        &self,
        entities: &[Entity<'static>],
    ) -> Result<Vec<SharedAccess>, Report> {
        self.cached_lookups.fetch_add(1, Ordering::SeqCst);
        Ok(vec![SharedAccess {
            entities: entities.to_vec(),
            users: self.cached.clone(),
        }])
    }

    async fn current_channel_members(
        &self,
        _channel_id: &str,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        self.current_reads.fetch_add(1, Ordering::SeqCst);
        Ok(self.current.clone())
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

/// What each user was sent, sorted by user.
type Sent = Vec<(String, Patch<Entity<'static>>)>;

/// Consumes `event` against `cached` and `current` rosters; returns what each
/// user was sent and how many cached lookups and current reads it made.
async fn consume(
    event: DeclaredMacroEvent,
    cached: Vec<MacroUserIdStr<'static>>,
    current: Vec<MacroUserIdStr<'static>>,
) -> (Sent, usize, usize) {
    let published = Arc::new(Mutex::new(Vec::new()));
    let cached_lookups = Arc::new(AtomicUsize::new(0));
    let current_reads = Arc::new(AtomicUsize::new(0));
    let service = SoupRealtimeServiceImpl::new(
        CachedRoster {
            cached,
            current,
            cached_lookups: cached_lookups.clone(),
            current_reads: current_reads.clone(),
        },
        RecordingPublisher(published.clone()),
    );

    let outcome = process_event(&service, &NoPullRequestSessions, &event, || {}).await;

    assert!(matches!(outcome, EventOutcome::Notified));
    let mut sent: Sent = published
        .lock()
        .expect("messages lock")
        .iter()
        .map(|message| (message.user_id.to_string(), message.patch.clone()))
        .collect();
    sent.sort_by_key(|(user_id, patch)| (user_id.clone(), format!("{patch:?}")));
    (
        sent,
        cached_lookups.load(Ordering::SeqCst),
        current_reads.load(Ordering::SeqCst),
    )
}

fn removal(
    channel_id: Uuid,
    channel_type: ChannelType,
    removed: Vec<MacroUserIdStr<'static>>,
) -> DeclaredMacroEvent {
    DeclaredMacroEvent::ChannelMacroEvent(ChannelMacroEvent::participant_removed(
        ChannelParticipantRemovedMetadata {
            channel_id,
            channel_type,
            removed_by: user(),
            removed_user_ids: removed,
        },
    ))
}

/// A removal consumed after one of the removed was added back, while the
/// cached roster still predates the add: that one is a member again and must
/// keep the channel.
#[tokio::test]
async fn a_member_added_back_before_their_removal_is_consumed_keeps_the_channel() {
    let channel_id = Uuid::now_v7();
    let channel = EntityType::Channel.with_entity_string(channel_id.to_string());
    for channel_type in [ChannelType::Private, ChannelType::DirectMessage] {
        let (sent, cached_lookups, current_reads) = consume(
            removal(
                channel_id,
                channel_type,
                vec![person("back"), person("gone")],
            ),
            vec![person("member")],
            vec![person("member"), person("back")],
        )
        .await;

        assert_eq!(
            sent,
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
        assert_eq!((cached_lookups, current_reads), (0, 1), "{channel_type:?}");
    }
}

/// A removal consumed while the cached roster still lists the removed member:
/// they lose the channel all the same.
#[tokio::test]
async fn a_removed_member_still_in_the_cached_roster_loses_the_channel() {
    let channel_id = Uuid::now_v7();
    let channel = EntityType::Channel.with_entity_string(channel_id.to_string());
    for channel_type in [ChannelType::Private, ChannelType::DirectMessage] {
        let (sent, _, _) = consume(
            removal(channel_id, channel_type, vec![person("gone")]),
            vec![person("member"), person("gone")],
            vec![person("member")],
        )
        .await;

        assert_eq!(
            sent,
            vec![
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

/// An add consumed while the cached roster predates it still reaches the
/// added members.
#[tokio::test]
async fn members_added_after_the_roster_was_cached_hear_the_channel() {
    let channel_id = Uuid::now_v7();
    let channel = EntityType::Channel.with_entity_string(channel_id.to_string());
    let event = DeclaredMacroEvent::ChannelMacroEvent(ChannelMacroEvent::participant_added(
        ChannelParticipantAddedMetadata {
            channel_id,
            channel_type: ChannelType::Private,
            added_by: ChannelSender::new_from_user(user()),
            added_user_ids: vec![person("new")],
        },
    ));

    let (sent, _, _) = consume(
        event,
        vec![person("member")],
        vec![person("member"), person("new")],
    )
    .await;

    assert_eq!(
        sent,
        vec![
            (
                person("member").to_string(),
                Patch::Updated(channel.clone())
            ),
            (person("new").to_string(), Patch::Updated(channel)),
        ]
    );
}
