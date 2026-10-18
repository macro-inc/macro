use super::*;

#[test]
fn group_fixtures_keep_valid_siblings_and_drop_individual_delivery_facts() {
    let payload = serde_json::from_str(include_str!("../fixtures/whatsapp_groups.json")).unwrap();
    let batch = super::super::decode(Provider::Whatsapp, &payload).unwrap();
    assert_eq!(batch.invalid_items, 1);
    assert_eq!(batch.events.len(), 10);
    assert!(
        matches!(&batch.events[0],IncomingEvent::Group(GroupEvent {fact:GroupFact::Created {request_id,..},..}) if request_id.as_str()=="current-request")
    );
    assert_eq!(
        batch
            .events
            .iter()
            .filter(|e| matches!(
                e,
                IncomingEvent::Group(GroupEvent {
                    fact: GroupFact::Participant { .. },
                    ..
                })
            ))
            .count(),
        3
    );
    assert!(!batch.events.iter().any(|e| matches!(
        e,
        IncomingEvent::Group(GroupEvent {
            fact: GroupFact::Deleted { .. },
            ..
        })
    )));
    assert!(
        !batch
            .events
            .iter()
            .any(|e| matches!(e, IncomingEvent::IdentityObserved { .. }))
    );
    assert!(!batch.events.iter().any(|e| matches!(
        e,
        IncomingEvent::Status {
            state: DeliveryState::Delivered | DeliveryState::Read,
            ..
        }
    )));
    let message = batch
        .events
        .iter()
        .find_map(|e| {
            if let IncomingEvent::Message(m) = e {
                Some(m)
            } else {
                None
            }
        })
        .unwrap();
    assert_eq!(message.group_id.as_ref().unwrap().as_str(), "opaque-group");
    assert_eq!(message.customer_id.as_str(), "US.A");
    assert_eq!(message.author_name.as_deref(), Some("Alice"));
    assert!(
        matches!(batch.events.last().unwrap(),IncomingEvent::Status {state:DeliveryState::Failed,error_code:Some(code),..} if code=="131020")
    );
}
