use std::collections::{HashSet, VecDeque};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};

use super::*;
use crate::domain::ports::{SoupRealtimeConsumer, SoupRealtimePublisher, UserAccessExpander};

const DOCUMENT_ID: &str = "00000000-0000-0000-0000-000000000001";
const OTHER_DOCUMENT_ID: &str = "00000000-0000-0000-0000-000000000002";

struct FakeAccessExpander {
    users: Vec<MacroUserIdStr<'static>>,
    fail: bool,
    calls: Arc<AtomicUsize>,
    entities: Arc<Mutex<Vec<Entity<'static>>>>,
}

impl UserAccessExpander for FakeAccessExpander {
    async fn expand_user_access(
        &self,
        entity: &Entity<'static>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.entities
            .lock()
            .expect("access entities lock")
            .push(entity.clone());
        if self.fail {
            Err(rootcause::report!("access unavailable"))
        } else {
            Ok(self.users.clone())
        }
    }
}

struct FakeRealtimeConsumer {
    messages: Mutex<VecDeque<Result<SoupRealtimeMessage, Report>>>,
    calls: Arc<AtomicUsize>,
}

impl SoupRealtimeConsumer for FakeRealtimeConsumer {
    async fn recv(&self) -> Result<SoupRealtimeMessage, Report> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.messages
            .lock()
            .expect("consumer messages lock")
            .pop_front()
            .unwrap_or_else(|| Err(rootcause::report!("consumer stopped")))
    }
}

struct FakePublisher {
    messages: Arc<Mutex<Vec<SoupRealtimeMessage>>>,
    fail_users: HashSet<String>,
}

impl SoupRealtimePublisher for FakePublisher {
    async fn publish(&self, message: SoupRealtimeMessage) -> Result<(), Report> {
        let should_fail = self.fail_users.contains(message.user_id.as_ref());
        self.messages.lock().expect("messages lock").push(message);
        if should_fail {
            Err(rootcause::report!("publisher unavailable"))
        } else {
            Ok(())
        }
    }
}

struct Harness {
    service: SoupRealtimeServiceImpl,
    access_calls: Arc<AtomicUsize>,
    access_entities: Arc<Mutex<Vec<Entity<'static>>>>,
    messages: Arc<Mutex<Vec<SoupRealtimeMessage>>>,
}

async fn wait_until(mut condition: impl FnMut() -> bool) {
    tokio::time::timeout(Duration::from_secs(1), async {
        while !condition() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("background worker completes");
}

fn user(local: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{local}@example.com")).expect("valid user id")
}

fn document(id: &str) -> Entity<'static> {
    EntityType::Document.with_entity_string(id.to_string())
}

fn updated_document() -> Patch<Entity<'static>> {
    Patch::Updated(document(DOCUMENT_ID))
}

fn harness(
    users: Vec<MacroUserIdStr<'static>>,
    access_fails: bool,
    fail_users: HashSet<String>,
) -> Harness {
    let access_calls = Arc::new(AtomicUsize::new(0));
    let access_entities = Arc::new(Mutex::new(Vec::new()));
    let messages = Arc::new(Mutex::new(Vec::new()));
    let service = SoupRealtimeServiceImpl::new(
        FakeAccessExpander {
            users,
            fail: access_fails,
            calls: access_calls.clone(),
            entities: access_entities.clone(),
        },
        FakePublisher {
            messages: messages.clone(),
            fail_users,
        },
    );
    Harness {
        service,
        access_calls,
        access_entities,
        messages,
    }
}

#[tokio::test(start_paused = true)]
async fn consumer_service_distributes_patches_only_to_their_users() {
    let one = user("one");
    let two = user("two");
    let one_patch = Patch::Updated(document(DOCUMENT_ID));
    let two_patch = Patch::Deleted(document(OTHER_DOCUMENT_ID));
    let receive_calls = Arc::new(AtomicUsize::new(0));
    let consumer = FakeRealtimeConsumer {
        messages: Mutex::new(VecDeque::from([
            Err(rootcause::report!("transient receive failure")),
            Ok(SoupRealtimeMessage::new(one.clone(), one_patch.clone())),
            Ok(SoupRealtimeMessage::new(two.clone(), two_patch.clone())),
        ])),
        calls: Arc::clone(&receive_calls),
    };
    let service = Arc::new(SoupRealtimeConsumerService::new(consumer));
    let mut one_first = service.subscribe(one.clone());
    let mut one_second = service.subscribe(one);
    let mut two_receiver = service.subscribe(two);

    let run_error = tokio::spawn({
        let service = Arc::clone(&service);
        async move { service.run().await }
    })
    .await
    .expect("consumer task joins")
    .expect_err("fake consumer eventually stops");
    assert!(run_error.to_string().contains("failed to receive"));
    assert_eq!(
        receive_calls.load(Ordering::SeqCst),
        3 + MAX_RECEIVE_ATTEMPTS,
        "a successful patch resets the receive retry strategy"
    );

    assert_eq!(
        tokio::time::timeout(Duration::from_secs(1), one_first.recv())
            .await
            .expect("first subscription receives")
            .expect("subscription remains open"),
        one_patch
    );
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(1), one_second.recv())
            .await
            .expect("second subscription receives")
            .expect("subscription remains open"),
        one_patch
    );
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(1), two_receiver.recv())
            .await
            .expect("other user subscription receives")
            .expect("subscription remains open"),
        two_patch
    );
}

#[tokio::test]
async fn zero_users_skips_publication() {
    let harness = harness(Vec::new(), false, HashSet::new());

    harness
        .service
        .notify_users(SoupRealtimePatch::for_entity(updated_document()))
        .expect("patch is queued");

    wait_until(|| harness.access_calls.load(Ordering::SeqCst) == 1).await;
    assert!(harness.messages.lock().expect("messages lock").is_empty());
}

#[tokio::test]
async fn recipient_expansion_can_use_a_different_entity_from_the_patch() {
    let recipient = user("one");
    let harness = harness(vec![recipient], false, HashSet::new());
    let channel = EntityType::Channel.with_entity_string(OTHER_DOCUMENT_ID.to_string());

    harness
        .service
        .notify_users(SoupRealtimePatch::new(updated_document(), channel.clone()))
        .expect("patch is queued");

    wait_until(|| {
        harness
            .access_entities
            .lock()
            .expect("access entities lock")
            .len()
            == 1
    })
    .await;

    assert_eq!(
        harness
            .access_entities
            .lock()
            .expect("access entities lock")
            .as_slice(),
        &[channel]
    );
}

#[tokio::test]
async fn updated_and_deleted_patches_are_published_unchanged() {
    for patch in [
        Patch::Updated(document(DOCUMENT_ID)),
        Patch::Deleted(document(DOCUMENT_ID)),
    ] {
        let recipient = user("one");
        let harness = harness(vec![recipient.clone()], false, HashSet::new());

        harness
            .service
            .notify_users(SoupRealtimePatch::for_entity(patch.clone()))
            .expect("patch is queued");

        wait_until(|| harness.messages.lock().expect("messages lock").len() == 1).await;
        let messages = harness.messages.lock().expect("messages lock");
        assert_eq!(
            messages.as_slice(),
            &[SoupRealtimeMessage::new(recipient, patch)]
        );
    }
}

#[tokio::test]
async fn duplicate_accessors_are_deduplicated() {
    let one = user("one");
    let two = user("two");
    let harness = harness(vec![one.clone(), two, one], false, HashSet::new());

    harness
        .service
        .notify_users(SoupRealtimePatch::for_entity(updated_document()))
        .expect("patch is queued");

    wait_until(|| harness.messages.lock().expect("messages lock").len() == 2).await;
}

#[tokio::test]
async fn access_failure_prevents_publication() {
    let harness = harness(vec![user("one")], true, HashSet::new());

    harness
        .service
        .notify_users(SoupRealtimePatch::for_entity(updated_document()))
        .expect("patch is queued");

    wait_until(|| harness.access_calls.load(Ordering::SeqCst) == 1).await;
    assert!(harness.messages.lock().expect("messages lock").is_empty());
}

#[tokio::test]
async fn publisher_failure_does_not_block_other_messages() {
    let users = [user("one"), user("two"), user("three")];
    let harness = harness(
        users.to_vec(),
        false,
        HashSet::from([users[1].as_ref().to_string()]),
    );

    harness
        .service
        .notify_users(SoupRealtimePatch::for_entity(updated_document()))
        .expect("patch is queued");

    wait_until(|| harness.messages.lock().expect("messages lock").len() == 3).await;
}
