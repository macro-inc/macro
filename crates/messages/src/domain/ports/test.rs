use super::*;
use activity::domain::models::NameChange;
use activity::{Action, Activity, Actor, CommonAction, DomainActivity, EntityType};

const CHANNEL: Uuid = Uuid::from_u128(10);

/// A channel fact as the channels domain would record it.
struct ChannelFact(String, Action);

impl DomainActivity for ChannelFact {
    const ENTITY_TYPE: EntityType = EntityType::Channel;

    fn entity_id(&self) -> &str {
        &self.0
    }

    fn into_action(self) -> Action {
        self.1
    }
}

fn actor() -> Actor<'static> {
    Actor::new_from_user("macro|test@example.com".to_owned().try_into().unwrap())
}

fn channel_fact(channel: &str, action: Action) -> Activity {
    Activity::from_domain(
        Uuid::from_u128(1),
        0,
        actor(),
        None,
        ChannelFact(channel.to_owned(), action),
        chrono::Utc::now(),
    )
}

#[test]
fn live_activity_finds_the_timeline_its_reads_would_show() {
    let renamed = || {
        Action::Renamed(NameChange {
            from: None,
            to: Some("New".into()),
        })
    };
    assert_eq!(
        timeline_parent(&channel_fact(&CHANNEL.to_string(), renamed())),
        Some(MessageParent::Channel(CHANNEL))
    );
    assert_eq!(
        timeline_parent(&channel_fact(&CHANNEL.to_string(), Action::Edited)),
        None,
        "edits are not timeline facts"
    );
    assert_eq!(
        timeline_parent(&channel_fact("not-a-channel", renamed())),
        None
    );

    // Parents without a timeline source never receive live activity.
    let task = Activity::common(
        Uuid::from_u128(2),
        0,
        actor(),
        None,
        EntityType::Document,
        "task-1",
        CommonAction::Created,
        chrono::Utc::now(),
    );
    assert_eq!(timeline_parent(&task), None);
}
