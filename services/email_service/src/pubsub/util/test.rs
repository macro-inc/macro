use super::{build_notification_recipients, publish_document_email_attachment_unlinked};
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::Value;
use std::sync::Mutex;

fn id(s: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(s.to_string()).expect("valid macro user id")
}

#[test]
fn fans_out_to_owner_and_every_delegated_primary() {
    let owner = id("macro|shared@team.test");
    let primaries = vec![
        "macro|alice@team.test".to_string(),
        "macro|bob@team.test".to_string(),
    ];

    let recipients = build_notification_recipients(&owner, primaries);

    assert_eq!(recipients.len(), 3);
    assert!(recipients.contains(&owner));
    assert!(recipients.contains(&id("macro|alice@team.test")));
    assert!(recipients.contains(&id("macro|bob@team.test")));
}

#[test]
fn owner_only_when_no_delegates() {
    let owner = id("macro|solo@personal.test");
    let recipients = build_notification_recipients(&owner, vec![]);
    assert_eq!(recipients.len(), 1);
    assert!(recipients.contains(&owner));
}

#[test]
fn skips_primaries_that_fail_to_parse() {
    let owner = id("macro|shared@team.test");
    let primaries = vec![
        "not-a-macro-id".to_string(),
        "macro|ok@team.test".to_string(),
    ];

    let recipients = build_notification_recipients(&owner, primaries);

    assert_eq!(recipients.len(), 2);
    assert!(recipients.contains(&owner));
    assert!(recipients.contains(&id("macro|ok@team.test")));
}

#[derive(Default)]
struct RecordingEventBroker {
    published: Mutex<Vec<(String, String, Value)>>,
}

impl MacroEventBroker for RecordingEventBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        self.published
            .lock()
            .expect("published events lock should not be poisoned")
            .push((
                event.topic().to_string(),
                event.key().to_string(),
                serde_json::to_value(event.event())?,
            ));
        Ok(tokio::spawn(async { Ok(()) }))
    }
}

#[tokio::test]
async fn publishes_one_document_event_per_unlinked_document() {
    let broker = RecordingEventBroker::default();
    let first = "11111111-1111-1111-1111-111111111111".to_string();
    let second = "22222222-2222-2222-2222-222222222222".to_string();
    publish_document_email_attachment_unlinked(&broker, [first.clone(), second.clone()]);

    let published = broker
        .published
        .lock()
        .expect("published events lock should not be poisoned")
        .clone();
    assert_eq!(published.len(), 2);
    assert_eq!(published[0].0, "macro.documents");
    assert_eq!(published[0].1, first);
    assert_eq!(
        published[0].2["event_type"],
        "document.email_attachment_unlinked"
    );
    assert_eq!(published[0].2["metadata"]["document_id"], first);
    assert_eq!(published[1].1, second);
    assert_eq!(
        published[1].2["event_type"],
        "document.email_attachment_unlinked"
    );
}
