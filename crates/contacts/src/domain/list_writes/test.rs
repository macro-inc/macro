use super::*;
use crate::domain::models::list::InboxProvider;
use crate::domain::models::messages::{
    ContactConnections, ContactDisconnections, ContactsNodes, DirectoryChange,
};
use crate::domain::ports::ContactsIngressQueue;
use crate::domain::service::SqsContactsIngress;
use feature_flags::{FlagSnapshot, FlagValue};
use std::sync::Mutex as StdMutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use uuid::Uuid;

/// Answers every service read with `answer` and counts the reads.
struct Flags {
    answer: Result<Option<bool>, ()>,
    reads: AtomicUsize,
}

impl Flags {
    fn new(answer: Result<Option<bool>, ()>) -> Self {
        Self {
            answer,
            reads: AtomicUsize::new(0),
        }
    }
}

impl ServiceFeatureFlags for Flags {
    async fn load_service(&self, context: ServiceContext) -> Result<FlagSnapshot, Report> {
        assert_eq!(context.distinct_id(), "contacts-list-writes");
        self.reads.fetch_add(1, Ordering::SeqCst);
        match self.answer {
            Ok(Some(enabled)) => Ok(FlagSnapshot::new([(
                CONTACT_LIST_WRITES_FLAG.to_string(),
                FlagValue::Boolean(enabled),
            )])),
            Ok(None) => Ok(FlagSnapshot::default()),
            Err(()) => Err(rootcause::report!("PostHog unavailable")),
        }
    }
}

#[derive(Default)]
struct Sent {
    legacy: StdMutex<usize>,
    changes: StdMutex<Vec<DirectoryChange>>,
}

impl ContactsIngressQueue for &'static Sent {
    async fn publish_nodes(&self, _: ContactsNodes) -> Result<(), Report> {
        *self.legacy.lock().unwrap() += 1;
        Ok(())
    }

    async fn publish_connections(&self, _: ContactConnections) -> Result<(), Report> {
        *self.legacy.lock().unwrap() += 1;
        Ok(())
    }

    async fn publish_disconnections(&self, _: ContactDisconnections) -> Result<(), Report> {
        *self.legacy.lock().unwrap() += 1;
        Ok(())
    }

    async fn publish_change(&self, message: DirectoryChange) -> Result<(), Report> {
        self.changes.lock().unwrap().push(message);
        Ok(())
    }
}

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

fn gate(
    writes: ContactListWrites<Flags>,
) -> (
    ListWritesGate<SqsContactsIngress<&'static Sent>, Flags>,
    &'static Sent,
) {
    let sent: &'static Sent = Box::leak(Box::default());
    let gate = ListWritesGate {
        inner: SqsContactsIngress { queue: sent },
        writes,
    };
    (gate, sent)
}

async fn send_everything<I: ContactsIngress + ContactListIngress>(ingress: &I) {
    let (owner, contact) = (user("owner@example.com"), user("contact@example.com"));
    ingress
        .enqueue_contacts(HashSet::from([owner.clone(), contact.clone()]))
        .await
        .unwrap();
    ingress
        .enqueue_contact_connections(vec![ContactConnection::new(owner.clone(), contact.clone())])
        .await
        .unwrap();
    ingress
        .record_interactions(vec![owner.clone()], vec![contact.clone()])
        .await
        .unwrap();
    ingress
        .record_inbox_contacts(
            InboxSource {
                owner: owner.clone(),
                link_id: Uuid::nil(),
                provider: InboxProvider::Gmail,
            },
            vec![contact.clone()],
        )
        .await
        .unwrap();
    ingress
        .directory_changed(vec![owner.clone()], vec![contact])
        .await
        .unwrap();
    ingress.user_deleted(owner).await.unwrap();
}

#[tokio::test]
async fn a_local_stack_sends_list_messages_without_reading_a_flag() {
    let flags = Flags::new(Err(()));
    let writes = ContactListWrites::new(Environment::Local, Some(flags));
    assert!(writes.enabled().await);
    let ContactListWrites::Fixed(_) = writes else {
        panic!("a local stack reads no flag");
    };
}

#[tokio::test]
async fn a_deployment_without_flags_sends_none() {
    for environment in [Environment::Develop, Environment::Production] {
        let writes = ContactListWrites::<Flags>::new(environment, None);
        assert!(!writes.enabled().await);
    }
}

#[tokio::test]
async fn a_deployment_follows_the_flag_and_reads_off_when_it_cannot_tell() {
    for (answer, expected) in [
        (Ok(Some(true)), true),
        (Ok(Some(false)), false),
        (Ok(None), false),
        (Err(()), false),
    ] {
        let writes = ContactListWrites::new(Environment::Production, Some(Flags::new(answer)));
        assert_eq!(writes.enabled().await, expected, "{answer:?}");
    }
}

#[tokio::test(start_paused = true)]
async fn the_flag_is_read_about_once_a_minute() {
    let writes = ContactListWrites::new(Environment::Develop, Some(Flags::new(Ok(Some(true)))));
    let ContactListWrites::Flag { flags, .. } = &writes else {
        panic!("a deployment with flags reads them");
    };

    for _ in 0..5 {
        assert!(writes.enabled().await);
    }
    assert_eq!(flags.reads.load(Ordering::SeqCst), 1);

    tokio::time::advance(FLAG_TTL).await;
    assert!(writes.enabled().await);
    assert_eq!(flags.reads.load(Ordering::SeqCst), 2);
}

#[tokio::test(start_paused = true)]
async fn a_failed_read_is_off_until_the_next_read() {
    let writes = ContactListWrites::new(Environment::Develop, Some(Flags::new(Err(()))));
    let ContactListWrites::Flag { flags, .. } = &writes else {
        panic!("a deployment with flags reads them");
    };

    assert!(!writes.enabled().await);
    assert!(!writes.enabled().await);
    assert_eq!(flags.reads.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn while_off_only_legacy_messages_are_sent() {
    let (gate, sent) = gate(ContactListWrites::Fixed(false));

    send_everything(&gate).await;

    assert_eq!(*sent.legacy.lock().unwrap(), 2);
    assert!(sent.changes.lock().unwrap().is_empty());
}

#[tokio::test]
async fn while_on_every_message_is_sent() {
    let (gate, sent) = gate(ContactListWrites::Fixed(true));

    send_everything(&gate).await;

    assert_eq!(*sent.legacy.lock().unwrap(), 2);
    let kinds: Vec<_> = sent
        .changes
        .lock()
        .unwrap()
        .iter()
        .map(|change| match change {
            DirectoryChange::Interacted { .. } => "interacted",
            DirectoryChange::InboxContacts { .. } => "inbox_contacts",
            DirectoryChange::Changed { .. } => "changed",
            DirectoryChange::UserDeleted { .. } => "user_deleted",
        })
        .collect();
    assert_eq!(
        kinds,
        ["interacted", "inbox_contacts", "changed", "user_deleted"]
    );
}
