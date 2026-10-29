use std::sync::Mutex;

use chrono::Utc;
use external_chat::domain::ports::ExternalChatResult;
use uuid::Uuid;
use whatsapp_linked::domain::events::{
    InboundEvent, InboundKind, Message, MessageKind, SessionScope,
};
use whatsapp_linked::domain::models::Identity;

use super::{InboundGate, InboundStore};
use crate::domain::ports::InboundSink;

const GROUP: &str = "120363000000000001@g.us";
const SCOPE: SessionScope = SessionScope {
    account_id: Uuid::from_u128(1),
    lease_epoch: 1,
};

/// Adopted groups the test changes, and what was loaded and stored.
#[derive(Default)]
struct FakeStore {
    adopted: Mutex<Vec<String>>,
    loads: Mutex<usize>,
    stored: Mutex<Vec<Uuid>>,
    stored_chats: Mutex<Vec<String>>,
}

impl InboundStore for FakeStore {
    async fn observed_groups(&self, _scope: SessionScope) -> ExternalChatResult<Vec<String>> {
        *self.loads.lock().unwrap() += 1;
        Ok(self.adopted.lock().unwrap().clone())
    }

    async fn enqueue_inbound(
        &self,
        _scope: SessionScope,
        event: &InboundEvent,
    ) -> ExternalChatResult<()> {
        self.stored.lock().unwrap().push(event.event_id);
        self.stored_chats
            .lock()
            .unwrap()
            .push(event.group_jid.clone());
        Ok(())
    }
}

fn text(event: u128) -> InboundEvent {
    InboundEvent {
        event_id: Uuid::from_u128(event),
        group_jid: GROUP.to_owned(),
        chat_alternate_jid: None,
        source_at: Utc::now(),
        observed_at: Utc::now(),
        kind: InboundKind::Message(Message {
            source_id: format!("3EB0{event}"),
            sender: Identity {
                jid: "15552223333@s.whatsapp.net".to_owned(),
                alternate_jid: None,
                display_name: None,
            },
            kind: MessageKind::Text,
            text: "hello".to_owned(),
            history: false,
            from_me: false,
            revision: 0,
            target: None,
            media: vec![],
            mentions: vec![],
            forwarded: false,
            view_once: false,
            rich: None,
        }),
    }
}

#[tokio::test]
async fn an_adoption_committed_after_a_stale_load_is_seen_by_the_next_message() {
    let gate = InboundGate::new(FakeStore::default(), SCOPE);
    gate.reload().await;
    // The adoption commits right after that load; its NOTIFY is still in flight.
    gate.store.adopted.lock().unwrap().push(GROUP.to_owned());

    assert!(gate.accept(&text(1)).await);

    assert_eq!(*gate.store.stored.lock().unwrap(), vec![Uuid::from_u128(1)]);
}

#[tokio::test]
async fn adopted_groups_stay_cached_and_unadopted_ones_are_checked_every_time() {
    let gate = InboundGate::new(FakeStore::default(), SCOPE);
    gate.store.adopted.lock().unwrap().push(GROUP.to_owned());
    gate.reload().await;

    assert!(gate.accept(&text(1)).await);
    assert!(gate.accept(&text(2)).await);
    assert_eq!(*gate.store.loads.lock().unwrap(), 1, "hits use the cache");

    let mut other = text(3);
    other.group_jid = "120363000000000002@g.us".to_owned();
    assert!(gate.accept(&other).await, "an unadopted group is acked");
    assert!(gate.accept(&other).await);
    assert_eq!(*gate.store.loads.lock().unwrap(), 3, "every miss loads");
    assert_eq!(
        *gate.store.stored.lock().unwrap(),
        vec![Uuid::from_u128(1), Uuid::from_u128(2)]
    );
}

#[tokio::test]
async fn a_direct_chat_added_by_one_address_takes_messages_sent_to_the_other() {
    const PHONE: &str = "15552223333@s.whatsapp.net";
    const LID: &str = "987654321@lid";
    let gate = InboundGate::new(FakeStore::default(), SCOPE);
    gate.store.adopted.lock().unwrap().push(LID.to_owned());
    gate.reload().await;

    let mut by_phone = text(1);
    by_phone.group_jid = PHONE.to_owned();
    by_phone.chat_alternate_jid = Some(LID.to_owned());
    assert!(gate.accept(&by_phone).await);
    let mut unknown = text(2);
    unknown.group_jid = "15559990000@s.whatsapp.net".to_owned();
    unknown.chat_alternate_jid = Some("111@lid".to_owned());
    assert!(gate.accept(&unknown).await, "someone else's chat is acked");

    assert_eq!(*gate.store.stored.lock().unwrap(), vec![Uuid::from_u128(1)]);
    assert_eq!(
        *gate.store.stored_chats.lock().unwrap(),
        vec![LID.to_owned()],
        "stored under the address it was added by"
    );
}
