use model_entity::EntityType;

use super::*;
use crate::test_support::*;

#[test]
fn a_notification_in_another_lane_triggers_nothing() {
    let channel = entity(EntityType::Channel, 0xC0);
    let noise = as_noise(&channel_send(1, 0xC0, 0x100, 1));

    for update in [
        NotificationSubscriptionUpdate::New(noise.clone()),
        NotificationSubscriptionUpdate::Updated(noise.clone()),
    ] {
        assert_eq!(
            notification_trigger(
                update.clone(),
                CandidateKeying::FiledEntity,
                NotificationLane::Signal
            ),
            None,
        );
        assert_eq!(
            notification_trigger(
                update,
                CandidateKeying::FiledEntity,
                NotificationLane::Noise
            ),
            Some(FeedTrigger::Changed(vec![channel.clone()])),
        );
    }
}

#[test]
fn a_deletion_invalidates_every_lane() {
    for lane in [NotificationLane::Signal, NotificationLane::Noise] {
        assert_eq!(
            notification_trigger(
                NotificationSubscriptionUpdate::Deleted(uuid(1)),
                CandidateKeying::FiledEntity,
                lane,
            ),
            Some(FeedTrigger::Invalidated),
        );
    }
}
