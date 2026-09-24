use super::*;
use std::cell::{Cell, RefCell};

fn document() -> LoroDoc {
    let doc = LoroDoc::new();
    doc.get_map("metadata").insert("title", "Document").unwrap();
    doc.commit();
    doc
}
fn access() -> DocumentAccess {
    DocumentAccess::authorize("doc", "doc", true).unwrap()
}
fn delta(doc: &LoroDoc, root: &str, key: &str, value: &str) -> Vec<u8> {
    let fork = doc.fork();
    fork.get_map(root).insert(key, value).unwrap();
    fork.export(ExportMode::Updates {
        from: Cow::Owned(doc.oplog_vv()),
    })
    .unwrap()
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
            &doc.oplog_vv().encode(),
            &delta(&doc, "properties", "A1", "x")
        ),
        Err(DocumentError::Forbidden)
    ));
}

#[test]
fn preflight_is_isolated_and_stale_revision_never_changes_live_state() {
    let doc = document();
    let revision = doc.oplog_vv().encode();
    let update = delta(&doc, "properties", "A1", "42");
    let prepared = prepare_update(&access(), &doc, &revision, &update).unwrap();
    assert!(prepared.applied);
    assert!(doc.get_map("properties").get("A1").is_none());
    doc.get_map("properties").insert("B1", "peer").unwrap();
    doc.commit();
    assert!(matches!(
        prepare_update(&access(), &doc, &revision, &update),
        Err(DocumentError::Conflict)
    ));
    assert!(doc.get_map("properties").get("A1").is_none());
}

#[test]
fn applied_delta_retry_is_idempotent_even_after_another_edit() {
    let doc = document();
    let revision = doc.oplog_vv().encode();
    let update = delta(&doc, "properties", "A1", "42");
    doc.import(&update).unwrap();
    doc.get_map("properties").insert("B1", "peer").unwrap();
    doc.commit();
    let retried = prepare_update(&access(), &doc, &revision, &update).unwrap();
    assert!(!retried.applied);
    assert_eq!(retried.revision, doc.oplog_vv().encode());
}

#[test]
fn snapshots_and_updates_accept_text_maps_and_nested_containers() {
    let doc = document();
    doc.get_text("content").insert(0, "text").unwrap();
    doc.commit();
    let (bytes, revision) = snapshot(&access(), &doc).unwrap();
    let copy = LoroDoc::new();
    copy.import(&bytes).unwrap();
    assert_eq!(copy.oplog_vv().encode(), revision);
    assert_eq!(copy.get_deep_value(), doc.get_deep_value());

    let fork = doc.fork();
    fork.get_map("arbitrary")
        .insert_container("nested", loro::LoroText::new())
        .unwrap()
        .insert(0, "nested text")
        .unwrap();
    let update = fork
        .export(ExportMode::Updates {
            from: Cow::Owned(doc.oplog_vv()),
        })
        .unwrap();
    let prepared = prepare_update(&access(), &doc, &revision, &update).unwrap();
    assert!(prepared.applied);
    doc.import(&prepared.update).unwrap();
    assert_eq!(doc.get_deep_value(), fork.get_deep_value());
}

#[test]
fn rejects_snapshots_malformed_updates_and_missing_dependencies_without_mutation() {
    let doc = document();
    let revision = doc.oplog_vv().encode();
    let fork = doc.fork();
    fork.get_map("properties")
        .insert("first", "missing")
        .unwrap();
    fork.commit();
    let from = fork.oplog_vv();
    fork.get_map("properties")
        .insert("second", "pending")
        .unwrap();
    let pending = fork
        .export(ExportMode::Updates {
            from: Cow::Owned(from),
        })
        .unwrap();
    for update in [
        doc.export(ExportMode::Snapshot).unwrap(),
        vec![1, 2, 3],
        pending,
    ] {
        assert!(matches!(
            prepare_update(&access(), &doc, &revision, &update),
            Err(DocumentError::Invalid(_))
        ));
        assert_eq!(doc.oplog_vv().encode(), revision);
    }
}

#[test]
fn enforces_binary_revision_and_operation_bounds() {
    let doc = document();
    let revision = doc.oplog_vv().encode();
    let update = delta(&doc, "properties", "field", "value");
    for (revision, update) in [
        (revision.clone(), vec![0; MAX_BINARY_BYTES + 1]),
        (vec![0; MAX_REVISION_BYTES + 1], update.clone()),
    ] {
        assert!(matches!(
            prepare_update(&access(), &doc, &revision, &update),
            Err(DocumentError::TooLarge)
        ));
    }
    assert!(matches!(
        prepare_update(&access(), &doc, &[255], &update),
        Err(DocumentError::Invalid(_))
    ));
    let fork = doc.fork();
    fork.get_text("content")
        .insert(0, &"x".repeat(MAX_UPDATE_OPERATIONS as usize + 1))
        .unwrap();
    let update = fork
        .export(ExportMode::Updates {
            from: Cow::Owned(doc.oplog_vv()),
        })
        .unwrap();
    assert!(matches!(
        prepare_update(&access(), &doc, &revision, &update),
        Err(DocumentError::TooLarge)
    ));
    assert_eq!(doc.oplog_vv().encode(), revision);
}

struct UpdateHarness {
    doc: LoroDoc,
    calls: RefCell<Vec<&'static str>>,
    fail_persist: bool,
    fail_publish: Cell<bool>,
}

impl UpdateHarness {
    fn new() -> Self {
        Self {
            doc: document(),
            calls: RefCell::new(Vec::new()),
            fail_persist: false,
            fail_publish: Cell::new(false),
        }
    }
}

impl DocumentUpdatePort for UpdateHarness {
    fn document(&self) -> &LoroDoc {
        &self.doc
    }

    async fn apply_and_persist(&self, update: &[u8]) -> Result<(), DocumentError> {
        self.calls.borrow_mut().push("persist");
        self.doc.import(update).unwrap();
        if self.fail_persist {
            return Err(DocumentError::Persistence);
        }
        Ok(())
    }
}

impl DocumentUpdateEffects for UpdateHarness {
    fn broadcast(&self, update: &[u8]) -> Result<(), DocumentError> {
        self.calls.borrow_mut().push("broadcast");
        let preview = self.doc.fork();
        preview.import(update).unwrap();
        assert_eq!(preview.oplog_vv(), self.doc.oplog_vv());
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
    let revision = port.doc.oplog_vv().encode();
    let delta = delta(&port.doc, "properties", "A1", "42");
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
    let revision = port.doc.oplog_vv().encode();
    let delta = delta(&port.doc, "properties", "A1", "42");
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
    let revision = port.doc.oplog_vv().encode();
    let delta = delta(&port.doc, "properties", "A1", "42");
    port.fail_publish.set(true);
    let result = futures::executor::block_on(update(&access(), &port, &port, &revision, &delta));
    assert!(matches!(result, Err(DocumentError::Notification)));
    assert_eq!(*port.calls.borrow(), ["persist", "broadcast", "publish"]);
    assert!(port.doc.get_map("properties").get("A1").is_some());

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
