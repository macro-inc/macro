use super::*;
use automerge::{ObjType, ROOT, transaction::Transactable};
use std::cell::{Cell, RefCell};

fn document() -> Automerge {
    let mut doc = Automerge::new();
    let mut tx = doc.transaction();
    tx.put(ROOT, "title", "Document").unwrap();
    tx.commit();
    doc
}
fn access() -> DocumentAccess {
    DocumentAccess::authorize("doc", "doc", true).unwrap()
}
fn delta(doc: &Automerge, root: &str, key: &str, value: &str) -> Vec<u8> {
    let mut fork = doc.fork();
    let mut tx = fork.transaction();
    tx.put(ROOT, format!("{root}:{key}"), value).unwrap();
    tx.commit();
    fork.save_after(&doc.get_heads())
}
fn apply(doc: &mut Automerge, bytes: &[u8]) {
    doc.apply_changes(decode_changes(bytes).unwrap()).unwrap();
}

#[test]
fn permission_policy_requires_matching_document_and_edit_grant() {
    assert!(matches!(
        DocumentAccess::authorize("other", "doc", true),
        Err(DocumentError::Unauthorized)
    ));
    let reader = DocumentAccess::authorize("doc", "doc", false).unwrap();
    let doc = document();
    assert!(snapshot(&reader, &doc).is_ok());
    assert!(matches!(
        prepare_update(
            &reader,
            &doc,
            &encode_revision(&doc.get_heads()),
            &delta(&doc, "properties", "A1", "x")
        ),
        Err(DocumentError::Forbidden)
    ));
}

#[test]
fn preflight_is_isolated_and_stale_revision_never_changes_live_state() {
    let mut doc = document();
    let revision = encode_revision(&doc.get_heads());
    let change = delta(&doc, "properties", "A1", "42");
    assert!(
        prepare_update(&access(), &doc, &revision, &change)
            .unwrap()
            .applied
    );
    assert!(doc.get(ROOT, "properties:A1").unwrap().is_none());
    let other = delta(&doc, "properties", "B1", "peer");
    apply(&mut doc, &other);
    assert!(matches!(
        prepare_update(&access(), &doc, &revision, &change),
        Err(DocumentError::Conflict)
    ));
    assert!(doc.get(ROOT, "properties:A1").unwrap().is_none());
}

#[test]
fn applied_delta_retry_is_idempotent_even_after_another_edit() {
    let mut doc = document();
    let revision = encode_revision(&doc.get_heads());
    let change = delta(&doc, "properties", "A1", "42");
    apply(&mut doc, &change);
    let other = delta(&doc, "properties", "B1", "peer");
    apply(&mut doc, &other);
    let retried = prepare_update(&access(), &doc, &revision, &change).unwrap();
    assert!(!retried.applied);
    assert_eq!(retried.revision, encode_revision(&doc.get_heads()));
}

#[test]
fn snapshots_and_updates_accept_text_maps_and_nested_containers() {
    let mut doc = document();
    let mut tx = doc.transaction();
    let map = tx.put_object(ROOT, "arbitrary", ObjType::Map).unwrap();
    let text = tx.put_object(map, "text", ObjType::Text).unwrap();
    tx.splice_text(text, 0, 0, "nested text 🐺").unwrap();
    tx.commit();
    let (bytes, revision) = snapshot(&access(), &doc).unwrap();
    let restored = Automerge::load(&bytes).unwrap();
    assert_eq!(encode_revision(&restored.get_heads()), revision);
    assert_eq!(
        serde_json::to_value(automerge::AutoSerde::from(&restored)).unwrap(),
        serde_json::to_value(automerge::AutoSerde::from(&doc)).unwrap()
    );
}

#[test]
fn rejects_snapshots_malformed_truncated_and_missing_dependencies_without_mutation() {
    let doc = document();
    let revision = encode_revision(&doc.get_heads());
    let first = delta(&doc, "properties", "first", "missing");
    let mut fork = doc.fork();
    apply(&mut fork, &first);
    let pending = delta(&fork, "properties", "second", "pending");
    let valid = delta(&doc, "properties", "A1", "42");
    let mut trailing_garbage = valid.clone();
    trailing_garbage.extend_from_slice(&[1, 2, 3]);
    let mut bad_checksum = valid.clone();
    bad_checksum[4] ^= 0xff;
    for change in [
        bad_checksum,
        doc.save(),
        vec![1, 2, 3],
        pending,
        valid[..valid.len() - 1].to_vec(),
        trailing_garbage,
    ] {
        assert!(matches!(
            prepare_update(&access(), &doc, &revision, &change),
            Err(DocumentError::Invalid(_))
        ));
        assert_eq!(encode_revision(&doc.get_heads()), revision);
    }
}

#[test]
fn enforces_binary_revision_and_operation_bounds() {
    let doc = document();
    let revision = encode_revision(&doc.get_heads());
    let change = delta(&doc, "properties", "field", "value");
    for (revision, change) in [
        (revision.clone(), vec![0; MAX_BINARY_BYTES + 1]),
        (vec![0; MAX_REVISION_BYTES + 1], change.clone()),
    ] {
        assert!(matches!(
            prepare_update(&access(), &doc, &revision, &change),
            Err(DocumentError::TooLarge)
        ));
    }
    assert!(matches!(
        prepare_update(&access(), &doc, &[255], &change),
        Err(DocumentError::Invalid(_))
    ));
    let mut fork = doc.fork();
    let mut tx = fork.transaction();
    let text = tx.put_object(ROOT, "content", ObjType::Text).unwrap();
    tx.splice_text(text, 0, 0, &"x".repeat(100_001)).unwrap();
    tx.commit();
    assert!(matches!(
        prepare_update(
            &access(),
            &doc,
            &revision,
            &fork.save_after(&doc.get_heads())
        ),
        Err(DocumentError::TooLarge)
    ));
}

struct UpdateHarness {
    doc: std::sync::Mutex<Automerge>,
    calls: RefCell<Vec<&'static str>>,
    fail_persist: bool,
    fail_publish: Cell<bool>,
}

impl UpdateHarness {
    fn new() -> Self {
        Self {
            doc: std::sync::Mutex::new(document()),
            calls: RefCell::new(Vec::new()),
            fail_persist: false,
            fail_publish: Cell::new(false),
        }
    }
}

impl DocumentUpdatePort for UpdateHarness {
    fn document(&self) -> MutexGuard<'_, Automerge> {
        self.doc.lock().unwrap()
    }

    async fn apply_and_persist(&self, update: &[u8]) -> Result<(), DocumentError> {
        self.calls.borrow_mut().push("persist");
        self.doc
            .lock()
            .unwrap()
            .apply_changes(decode_changes(update).unwrap())
            .unwrap();
        if self.fail_persist {
            return Err(DocumentError::Persistence);
        }
        Ok(())
    }
}

impl DocumentUpdateEffects for UpdateHarness {
    fn broadcast(&self, update: &[u8]) -> Result<(), DocumentError> {
        self.calls.borrow_mut().push("broadcast");
        let mut preview = self.doc.lock().unwrap().clone();
        preview
            .apply_changes(decode_changes(update).unwrap())
            .unwrap();
        assert_eq!(preview.get_heads(), self.doc.lock().unwrap().get_heads());
        Ok(())
    }

    fn publish_changed_document(&self) -> Result<(), DocumentError> {
        self.calls.borrow_mut().push("publish");
        if self.fail_publish.get() {
            return Err(DocumentError::Notification);
        }
        Ok(())
    }

    async fn keep_alive(&self) -> Result<(), DocumentError> {
        self.calls.borrow_mut().push("keep_alive");
        Ok(())
    }
}

#[test]
fn update_use_case_persists_before_broadcast_and_publishes_new_edits() {
    let port = UpdateHarness::new();
    let revision = encode_revision(&port.doc.lock().unwrap().get_heads());
    let delta = delta(&port.doc.lock().unwrap(), "properties", "A1", "42");
    let prepared =
        futures::executor::block_on(update(&access(), &port, &port, &revision, &delta)).unwrap();
    assert!(prepared.applied);
    assert_eq!(
        *port.calls.borrow(),
        ["persist", "broadcast", "publish", "keep_alive"]
    );

    port.calls.borrow_mut().clear();
    let retried =
        futures::executor::block_on(update(&access(), &port, &port, &revision, &delta)).unwrap();
    assert!(!retried.applied);
    assert_eq!(*port.calls.borrow(), ["persist", "broadcast", "keep_alive"]);
}

#[test]
fn rejected_or_unpersisted_update_never_notifies() {
    let mut port = UpdateHarness::new();
    let revision = encode_revision(&port.doc.lock().unwrap().get_heads());
    let delta = delta(&port.doc.lock().unwrap(), "properties", "A1", "42");
    let viewer = DocumentAccess::authorize("doc", "doc", false).unwrap();
    let result = futures::executor::block_on(update(&viewer, &port, &port, &revision, &delta));
    assert!(matches!(result, Err(DocumentError::Forbidden)));
    assert!(port.calls.borrow().is_empty());

    port.fail_persist = true;
    let result = futures::executor::block_on(update(&access(), &port, &port, &revision, &delta));
    assert!(matches!(result, Err(DocumentError::Persistence)));
    assert_eq!(*port.calls.borrow(), ["persist"]);
}

#[test]
fn notification_failure_preserves_durable_update_and_allows_idempotent_retry() {
    let port = UpdateHarness::new();
    let revision = encode_revision(&port.doc.lock().unwrap().get_heads());
    let delta = delta(&port.doc.lock().unwrap(), "properties", "A1", "42");
    port.fail_publish.set(true);
    let result = futures::executor::block_on(update(&access(), &port, &port, &revision, &delta));
    assert!(matches!(result, Err(DocumentError::Notification)));
    assert_eq!(*port.calls.borrow(), ["persist", "broadcast", "publish"]);
    assert!(
        port.doc
            .lock()
            .unwrap()
            .get(ROOT, "properties:A1")
            .unwrap()
            .is_some()
    );

    port.calls.borrow_mut().clear();
    port.fail_publish.set(false);
    let retried =
        futures::executor::block_on(update(&access(), &port, &port, &revision, &delta)).unwrap();
    assert!(!retried.applied);
    assert_eq!(*port.calls.borrow(), ["persist", "broadcast", "keep_alive"]);
}

#[test]
fn session_attribution_uses_the_verified_human_or_agent_identity() {
    let long_user = format!(
        "macro|{}@{}.{}.{}",
        "a".repeat(64),
        "b".repeat(63),
        "c".repeat(63),
        "d".repeat(61)
    );
    assert_eq!(long_user.len(), 260);
    assert_eq!(
        DocumentAttribution::from_session_claims(None, Some(long_user.clone()))
            .unwrap()
            .unwrap()
            .actor,
        long_user
    );

    let user = "macro|editor@example.com".to_string();
    assert_eq!(
        DocumentAttribution::from_session_claims(None, Some(user.clone())).unwrap(),
        Some(DocumentAttribution {
            actor: user.clone(),
            on_behalf_of: None
        })
    );
    assert_eq!(
        DocumentAttribution::from_session_claims(Some("bot|agent".into()), Some(user.clone()))
            .unwrap(),
        Some(DocumentAttribution {
            actor: "bot|agent".into(),
            on_behalf_of: Some(user)
        })
    );
    assert_eq!(
        DocumentAttribution::from_session_claims(None, None).unwrap(),
        None
    );
    assert!(DocumentAttribution::from_session_claims(None, Some("x".repeat(1025))).is_err());
}
