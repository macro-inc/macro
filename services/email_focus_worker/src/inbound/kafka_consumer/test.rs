use chrono::Utc;
use email::domain::events::{
    EmailEventOrigin, MessageReceivedMetadata, MessageSentMetadata, ThreadReadMetadata,
};
use macro_user_id::user_id::MacroUserIdStr;

use super::*;

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@acme.com").unwrap()
}

fn received(thread_id: Uuid, is_spam_or_trash: bool) -> EmailTopicEvent {
    EmailTopicEvent::MessageReceived(MessageReceivedMetadata {
        link_id: Uuid::new_v4(),
        owner: owner(),
        message_id: Uuid::new_v4(),
        provider_message_id: "p".to_owned(),
        thread_id,
        provider_thread_id: "t".to_owned(),
        is_new_thread: false,
        subject: None,
        from_email: None,
        from_name: None,
        to_emails: Vec::new(),
        attachment_count: 0,
        is_spam_or_trash,
        received_at: None,
    })
}

#[test]
fn incoming_mail_and_replies_trigger_classification() {
    let thread_id = Uuid::new_v4();
    assert_eq!(
        thread_to_classify(&received(thread_id, false)),
        Some(thread_id)
    );
    assert_eq!(thread_to_classify(&received(thread_id, true)), None);
    let sent = EmailTopicEvent::MessageSent(MessageSentMetadata {
        link_id: Uuid::new_v4(),
        owner: owner(),
        actor: None,
        message_id: Uuid::new_v4(),
        provider_message_id: "p".to_owned(),
        thread_id,
        provider_thread_id: "t".to_owned(),
        subject: None,
        to_emails: Vec::new(),
        cc_emails: Vec::new(),
        origin: EmailEventOrigin::ProviderSync,
        sent_at: Utc::now(),
    });
    assert_eq!(thread_to_classify(&sent), Some(thread_id));
}

#[test]
fn other_events_are_ignored() {
    let read = EmailTopicEvent::ThreadRead(ThreadReadMetadata {
        link_id: Uuid::new_v4(),
        owner: owner(),
        actor: None,
        thread_id: Uuid::new_v4(),
        is_read: true,
        origin: EmailEventOrigin::ProviderSync,
    });
    assert_eq!(thread_to_classify(&read), None);
}
