use super::*;
use objc2_intents::INSpeakable;

#[test]
fn a_channel_message_is_a_group_conversation_named_for_its_channel() {
    let sender = Sender {
        id: "macro|ada@example.com".into(),
        name: "Ada Lovelace".into(),
        avatar_url: None,
    };
    let content = UNMutableNotificationContent::new();
    content.setBody(&NSString::from_str("Ship it"));
    let intent = message_intent(&content, &sender, None, Some("design"), Some("channel-1"));

    // SAFETY: these getters take no arguments and return retained objects.
    unsafe {
        // Fewer than two recipients makes macOS drop the channel name.
        let recipients = intent.recipients().expect("a group has recipients");
        assert_eq!(recipients.count(), 2);
        assert_eq!(
            intent
                .speakableGroupName()
                .expect("a group is named")
                .spokenPhrase()
                .to_string(),
            "design"
        );
        assert_eq!(
            intent
                .conversationIdentifier()
                .expect("the channel identifies the conversation")
                .to_string(),
            "channel-1"
        );
        let from = intent.sender().expect("the message has a sender");
        assert_eq!(from.displayName().to_string(), "Ada Lovelace");
        assert_eq!(
            intent
                .content()
                .expect("the body is the message")
                .to_string(),
            "Ship it"
        );
    }
}

#[test]
fn a_direct_message_stays_between_two_people() {
    let sender = Sender {
        id: "macro|ada@example.com".into(),
        name: "Ada Lovelace".into(),
        avatar_url: None,
    };
    let content = UNMutableNotificationContent::new();
    content.setBody(&NSString::from_str("Ship it"));
    let intent = message_intent(&content, &sender, None, None, Some("channel-1"));

    // SAFETY: these getters take no arguments and return retained objects.
    unsafe {
        assert!(
            intent
                .recipients()
                .is_none_or(|recipients| recipients.count() == 0)
        );
        assert!(intent.speakableGroupName().is_none());
        assert_eq!(
            intent
                .sender()
                .expect("the message has a sender")
                .displayName()
                .to_string(),
            "Ada Lovelace"
        );
    }
}
