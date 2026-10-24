use super::*;
use crate::{domain::models::FeedNotification, test_support::*};

const CHANNEL: u128 = 0xC0;

fn thread(id: u128) -> Entity<'static> {
    entity(EntityType::ChannelMessage, id)
}

#[test]
fn thread_scoped_channel_notifications_recompute_the_channel_and_its_thread() {
    let channel = entity(EntityType::Channel, CHANNEL);
    let keys = |row: FeedNotification| trigger_keys(&row, CandidateKeying::ThreadScoped);
    assert_eq!(
        keys(channel_reply(1, CHANNEL, 0x70, 0x71, 1)),
        vec![channel.clone(), thread(0x70)]
    );
    assert_eq!(
        keys(channel_mention(2, CHANNEL, 0x72, None, 1)),
        vec![channel.clone(), thread(0x72)]
    );
    // A plain send may root a thread that absorbs it.
    assert_eq!(
        keys(channel_send(3, CHANNEL, 0x73, 1)),
        vec![channel.clone(), thread(0x73)]
    );
    assert_eq!(keys(channel_invite(4, CHANNEL, 1)), vec![channel]);
}

#[test]
fn filed_entity_notifications_recompute_only_their_entity() {
    let channel = entity(EntityType::Channel, CHANNEL);
    for row in [
        channel_reply(1, CHANNEL, 0x70, 0x71, 1),
        channel_mention(2, CHANNEL, 0x72, Some(0x70), 1),
        channel_reaction(3, CHANNEL, 0x74, Some(0x70), 1),
        channel_send(4, CHANNEL, 0x73, 1),
    ] {
        assert_eq!(
            trigger_keys(&row, CandidateKeying::FiledEntity),
            vec![channel.clone()]
        );
    }
}

#[test]
fn other_notifications_recompute_their_entity() {
    let document = entity(EntityType::Document, 0xD0);
    for keying in [CandidateKeying::ThreadScoped, CandidateKeying::FiledEntity] {
        assert_eq!(
            trigger_keys(&doc_comment(1, 0xD0, 0xA0, 0xA0, 1), keying),
            vec![document.clone()]
        );
    }
}

#[test]
fn thread_roots_follow_the_named_message() {
    let root = |row: FeedNotification| channel_thread_root(&row).map(str::to_string);
    assert_eq!(
        root(channel_reply(1, CHANNEL, 0x70, 0x71, 1)),
        Some(uuid(0x70).to_string())
    );
    // A root mention or reaction names the thread its message would root.
    assert_eq!(
        root(channel_mention(2, CHANNEL, 0x72, None, 1)),
        Some(uuid(0x72).to_string())
    );
    assert_eq!(
        root(channel_reaction(3, CHANNEL, 0x74, Some(0x70), 1)),
        Some(uuid(0x70).to_string())
    );
    assert_eq!(root(channel_send(4, CHANNEL, 0x73, 1)), None);
    assert_eq!(root(doc_comment(5, 0xD0, 0xA0, 0xA0, 1)), None);
}
