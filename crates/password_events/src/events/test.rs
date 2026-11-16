use super::*;
use macro_event_broker::Event;
use macro_event_broker::access::{Access, Audience, EntityRef, PublicEntityType, Stage};
use macro_user_id::user_id::MacroUserIdStr;

const AGENT: &str = "macro|agent@example.com";

fn resolved() -> PasswordTopicEvent {
    PasswordTopicEvent::AccessRequestResolved(AccessRequestResolvedMetadata {
        recipient_user_id: MacroUserIdStr::try_from(AGENT.to_owned()).unwrap(),
        team_id: Uuid::from_u128(1),
        item_id: Uuid::from_u128(2),
        request_id: Uuid::from_u128(3),
        status: AccessRequestResolution::Approved,
    })
}

/// A resolved request reaches only the account it is addressed to, as a
/// stable event about the vault item.
#[test]
fn a_resolution_is_for_its_recipient_alone() {
    let event = resolved();
    let Access::Public(public) = event.access().unwrap() else {
        panic!("a resolution is public");
    };

    assert_eq!(public.name, "passwords.access_request.resolved");
    assert_eq!(
        public.entity,
        EntityRef::new(
            PublicEntityType::PasswordItem,
            "00000000-0000-0000-0000-000000000002"
        )
    );
    assert_eq!(
        public.audience,
        Audience::Recipient {
            user_id: MacroUserIdStr::try_from(AGENT.to_owned()).unwrap(),
        }
    );
    assert_eq!(public.stage, Stage::Stable);
}

/// The delivered body is the published event without its routing recipient,
/// byte for byte what webhooks delivered before declared access.
#[test]
fn the_public_body_drops_only_the_recipient() {
    let event = Event::with_event_id(Uuid::nil(), resolved());
    let Access::Public(public) = event.event.access().unwrap() else {
        panic!("a resolution is public");
    };

    assert_eq!(
        serde_json::to_value(public.payload.as_ref()).unwrap(),
        serde_json::json!({
            "event_type": "passwords.access_request.resolved",
            "metadata": {
                "teamId": "00000000-0000-0000-0000-000000000001",
                "itemId": "00000000-0000-0000-0000-000000000002",
                "requestId": "00000000-0000-0000-0000-000000000003",
                "status": "approved",
            },
        })
    );
    let mut legacy = serde_json::to_value(&event.event).unwrap();
    legacy["metadata"]
        .as_object_mut()
        .unwrap()
        .remove("recipientUserId");
    assert_eq!(
        serde_json::to_value(public.payload.as_ref()).unwrap(),
        legacy
    );
}
