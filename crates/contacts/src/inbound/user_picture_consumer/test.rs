use super::*;
use macro_event_broker::{Event, MessageParts};
use user_events::UserPictureChangedMetadata;

struct TestMessage<'a> {
    topic: &'a str,
    payload: &'a [u8],
}

impl MessageParts for TestMessage<'_> {
    fn key(&self) -> Option<&str> {
        Some("macro|owner@example.com")
    }

    fn payload(&self) -> Option<&[u8]> {
        Some(self.payload)
    }

    fn topic(&self) -> &str {
        self.topic
    }
}

fn picture_changed() -> UserTopicEvent {
    UserTopicEvent::PictureChanged(UserPictureChangedMetadata {
        user_id: MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap(),
        file_id: Some("file".to_string()),
        url: None,
    })
}

#[test]
fn subscribes_to_macro_users() {
    assert_eq!(DeclaredMacroEvent::topics(), ["macro.users"]);
}

#[test]
fn decodes_picture_changed_events() {
    let payload = serde_json::to_vec(&Event::new(picture_changed())).expect("serializable");
    let decoded = DeclaredMacroEvent::decode(&TestMessage {
        topic: "macro.users",
        payload: &payload,
    })
    .expect("decodable");

    match decoded {
        DeclaredMacroEvent::UserMacroEvent(event) => {
            let user = picture_changed_user(&event.event().event).expect("picture event");
            assert_eq!(user.as_ref() as &str, "macro|owner@example.com");
        }
    }
}

#[test]
fn rejects_undecodable_payloads() {
    assert!(
        DeclaredMacroEvent::decode(&TestMessage {
            topic: "macro.users",
            payload: b"not json",
        })
        .is_err()
    );
}
