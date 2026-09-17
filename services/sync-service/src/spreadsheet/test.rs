use super::*;
use std::cell::{Cell, RefCell};

fn document() -> LoroDoc {
    let doc = LoroDoc::new();
    doc.import(include_bytes!(
        "../../../../static_assets/spreadsheet-golden.1.bin"
    ))
    .unwrap();
    doc
}
fn access() -> SpreadsheetAccess {
    SpreadsheetAccess::authorize("doc", "doc", true).unwrap()
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
        SpreadsheetAccess::authorize("other", "doc", true),
        Err(SpreadsheetError::Unauthorized)
    ));
    let reader = SpreadsheetAccess::authorize("doc", "doc", false).unwrap();
    let doc = document();
    assert!(snapshot(&reader, &doc).is_ok());
    assert!(matches!(
        prepare_update(
            &reader,
            &doc,
            &doc.oplog_vv().encode(),
            &delta(&doc, "spreadsheetValues", "A1", "x")
        ),
        Err(SpreadsheetError::Forbidden)
    ));
}

#[test]
fn preflight_is_isolated_and_stale_revision_never_changes_live_state() {
    let doc = document();
    let revision = doc.oplog_vv().encode();
    let update = delta(&doc, "spreadsheetValues", "A1", "42");
    let prepared = prepare_update(&access(), &doc, &revision, &update).unwrap();
    assert!(prepared.applied);
    assert!(doc.get_map("spreadsheetValues").get("A1").is_none());
    doc.get_map("spreadsheetValues")
        .insert("B1", "peer")
        .unwrap();
    doc.commit();
    assert!(matches!(
        prepare_update(&access(), &doc, &revision, &update),
        Err(SpreadsheetError::Conflict)
    ));
    assert!(doc.get_map("spreadsheetValues").get("A1").is_none());
}

#[test]
fn applied_delta_retry_is_idempotent_even_after_another_edit() {
    let doc = document();
    let revision = doc.oplog_vv().encode();
    let update = delta(&doc, "spreadsheetValues", "A1", "42");
    doc.import(&update).unwrap();
    doc.get_map("spreadsheetValues")
        .insert("B1", "peer")
        .unwrap();
    doc.commit();
    let retried = prepare_update(&access(), &doc, &revision, &update).unwrap();
    assert!(!retried.applied);
    assert_eq!(retried.revision, doc.oplog_vv().encode());
}

#[test]
fn rejects_other_document_types_roots_invalid_cells_and_snapshots() {
    let doc = document();
    let revision = doc.oplog_vv().encode();
    for (root, key, value) in [
        ("root", "content", "bad"),
        ("spreadsheetUnknown", "A1", "bad"),
        ("spreadsheetValues", "AA1", "bad"),
        ("spreadsheetValues", "A1001", "bad"),
        ("spreadsheetFontSize", "A1", "large"),
    ] {
        let update = delta(&doc, root, key, value);
        assert!(matches!(
            prepare_update(&access(), &doc, &revision, &update),
            Err(SpreadsheetError::Invalid(_))
        ));
    }
    let markdown = LoroDoc::new();
    markdown.get_text("content").insert(0, "text").unwrap();
    assert!(snapshot(&access(), &markdown).is_err());
    assert!(
        prepare_update(
            &access(),
            &doc,
            &revision,
            &doc.export(ExportMode::Snapshot).unwrap()
        )
        .is_err()
    );
    assert_eq!(doc.oplog_vv().encode(), revision);
}

#[test]
fn enforces_binary_and_schema_bounds() {
    let doc = document();
    assert!(matches!(
        prepare_update(
            &access(),
            &doc,
            &doc.oplog_vv().encode(),
            &vec![0; MAX_BINARY_BYTES + 1]
        ),
        Err(SpreadsheetError::TooLarge)
    ));
    let update = delta(&doc, "spreadsheetValues", "A1", &"x".repeat(10_001));
    assert!(matches!(
        prepare_update(&access(), &doc, &doc.oplog_vv().encode(), &update),
        Err(SpreadsheetError::Invalid(_))
    ));
}

#[test]
fn rejects_nested_containers_even_when_their_deep_value_looks_scalar() {
    let doc = document();
    let fork = doc.fork();
    fork.get_map("spreadsheetValues")
        .insert_container("A1", loro::LoroText::new())
        .unwrap()
        .insert(0, "looks like a string")
        .unwrap();
    let update = fork
        .export(ExportMode::Updates {
            from: Cow::Owned(doc.oplog_vv()),
        })
        .unwrap();
    assert!(matches!(
        prepare_update(&access(), &doc, &doc.oplog_vv().encode(), &update),
        Err(SpreadsheetError::Invalid(_))
    ));
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

impl SpreadsheetUpdatePort for UpdateHarness {
    fn document(&self) -> &LoroDoc {
        &self.doc
    }

    async fn apply_and_persist(&self, update: &[u8]) -> Result<(), SpreadsheetError> {
        self.calls.borrow_mut().push("persist");
        self.doc.import(update).unwrap();
        if self.fail_persist {
            return Err(SpreadsheetError::Persistence);
        }
        Ok(())
    }
}

impl SpreadsheetUpdateEffects for UpdateHarness {
    fn broadcast(&self, update: &[u8]) -> Result<(), SpreadsheetError> {
        self.calls.borrow_mut().push("broadcast");
        let preview = self.doc.fork();
        preview.import(update).unwrap();
        assert_eq!(preview.oplog_vv(), self.doc.oplog_vv());
        Ok(())
    }

    fn publish_changed_document(&self) -> Result<(), SpreadsheetError> {
        self.calls.borrow_mut().push("publish");
        if self.fail_publish.get() {
            return Err(SpreadsheetError::Notification);
        }
        Ok(())
    }

    async fn keep_alive(&self) -> Result<(), SpreadsheetError> {
        self.calls.borrow_mut().push("keep_alive");
        Ok(())
    }
}

#[test]
fn update_use_case_persists_before_broadcast_and_publishes_new_edits() {
    let port = UpdateHarness::new();
    let revision = port.doc.oplog_vv().encode();
    let delta = delta(&port.doc, "spreadsheetValues", "A1", "42");
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
    let delta = delta(&port.doc, "spreadsheetValues", "A1", "42");
    let viewer = SpreadsheetAccess::authorize("doc", "doc", false).unwrap();
    let result = futures::executor::block_on(update(&viewer, &port, &port, &revision, &delta));
    assert!(matches!(result, Err(SpreadsheetError::Forbidden)));
    assert!(port.calls.borrow().is_empty());

    port.fail_persist = true;
    let result = futures::executor::block_on(update(&access(), &port, &port, &revision, &delta));
    assert!(matches!(result, Err(SpreadsheetError::Persistence)));
    assert_eq!(*port.calls.borrow(), ["persist"]);
}

#[test]
fn notification_failure_preserves_durable_update_and_allows_idempotent_retry() {
    let port = UpdateHarness::new();
    let revision = port.doc.oplog_vv().encode();
    let delta = delta(&port.doc, "spreadsheetValues", "A1", "42");
    port.fail_publish.set(true);
    let result = futures::executor::block_on(update(&access(), &port, &port, &revision, &delta));
    assert!(matches!(result, Err(SpreadsheetError::Notification)));
    assert_eq!(*port.calls.borrow(), ["persist", "broadcast", "publish"]);
    assert!(port.doc.get_map("spreadsheetValues").get("A1").is_some());

    port.calls.borrow_mut().clear();
    port.fail_publish.set(false);
    let retried =
        futures::executor::block_on(update(&access(), &port, &port, &revision, &delta)).unwrap();
    assert!(!retried.applied);
    assert_eq!(*port.calls.borrow(), ["persist", "broadcast", "keep_alive"]);
}
