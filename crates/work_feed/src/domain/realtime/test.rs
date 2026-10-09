use super::*;
use crate::domain::test_support::*;

const CHANNEL: u128 = 0xC0;

fn thread(id: u128) -> Entity<'static> {
    entity(EntityType::ChannelMessage, id)
}

#[test]
fn channel_notifications_recompute_the_channel_and_its_thread() {
    let channel = entity(EntityType::Channel, CHANNEL);
    assert_eq!(
        notification_trigger_keys(&channel_reply(1, CHANNEL, 0x70, 0x71, 1)),
        vec![channel.clone(), thread(0x70)]
    );
    assert_eq!(
        notification_trigger_keys(&channel_mention(2, CHANNEL, 0x72, None, 1)),
        vec![channel.clone(), thread(0x72)]
    );
    // A plain send may root a thread that absorbs it.
    assert_eq!(
        notification_trigger_keys(&channel_send(3, CHANNEL, 0x73, 1)),
        vec![channel.clone(), thread(0x73)]
    );
    assert_eq!(
        notification_trigger_keys(&channel_invite(4, CHANNEL, 1)),
        vec![channel]
    );
}

#[test]
fn other_notifications_recompute_their_entity() {
    let document = entity(EntityType::Document, 0xD0);
    assert_eq!(
        notification_trigger_keys(&doc_comment(1, 0xD0, 0xA0, 0xA0, 1)),
        vec![document]
    );
}
