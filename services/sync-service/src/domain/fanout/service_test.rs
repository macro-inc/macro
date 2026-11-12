use super::*;
use futures::executor::block_on;
use loro::{ExportMode, LoroDoc};
use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;

#[derive(Debug, thiserror::Error)]
enum Error {
    #[error(transparent)]
    Domain(#[from] Failure),
    #[error("injected failure")]
    Injected,
}
#[derive(Default)]
struct Room {
    state: RefCell<PendingOperations>,
    doc: LoroDoc,
    rows: RefCell<BTreeMap<String, Vec<u8>>>,
    debt: RefCell<Option<FanoutDebt>>,
    events: RefCell<Vec<&'static str>>,
    sent: RefCell<Vec<Vec<u8>>>,
    fail: Cell<Option<&'static str>>,
    next: Cell<u32>,
}
impl Room {
    fn effect(&self, name: &'static str) -> Result<(), Error> {
        self.events.borrow_mut().push(name);
        if self.fail.get() == Some(name) {
            self.fail.set(None);
            return Err(Error::Injected);
        }
        Ok(())
    }
    fn cold(&self) -> Self {
        let cold = Self::default();
        *cold.rows.borrow_mut() = self.rows.borrow().clone();
        *cold.debt.borrow_mut() = self.debt.borrow().clone();
        for bytes in cold.rows.borrow().values() {
            cold.doc.import(bytes).unwrap();
        }
        let required = cold
            .rows
            .borrow()
            .iter()
            .map(|(key, bytes)| {
                (
                    key.clone(),
                    LoroDoc::decode_import_blob_meta(bytes, false)
                        .unwrap()
                        .partial_end_vv,
                )
            })
            .collect::<Vec<_>>();
        cold.with_pending(|state| {
            state.restore_debt(cold.debt.borrow().clone());
            state.restore_pending(required, &cold.doc.oplog_vv());
        });
        cold
    }
}
impl StatePort for Room {
    fn with_pending<T>(&self, apply: impl FnOnce(&mut PendingOperations) -> T) -> T {
        apply(&mut self.state.borrow_mut())
    }
}
impl AppendPort for Room {
    type Error = Error;
    type Imported = ();
    fn next_key(&self) -> String {
        self.next.set(self.next.get() + 1);
        self.next.get().to_string()
    }
    fn import(&self, update: &[u8]) -> Result<Imported<()>, Error> {
        let before = self.doc.oplog_vv();
        self.doc.import(update).unwrap();
        Ok(Imported {
            before,
            known: self.doc.oplog_vv(),
            required: LoroDoc::decode_import_blob_meta(update, false)
                .unwrap()
                .partial_end_vv,
            value: (),
        })
    }
    async fn store_debt(&self, debt: &FanoutDebt) -> Result<(), Error> {
        self.effect("intent")?;
        *self.debt.borrow_mut() = Some(debt.clone());
        Ok(())
    }
    async fn store_pending(&self, key: &str, update: &[u8]) -> Result<(), Error> {
        self.effect("pending")?;
        self.rows.borrow_mut().insert(key.into(), update.into());
        Ok(())
    }
    async fn store_archive(&self, _: &str, _: &[u8]) -> Result<(), Error> {
        self.effect("archive")
    }
}
impl DeliveryPort for Room {
    type Error = Error;
    fn known(&self) -> VersionVector {
        self.doc.oplog_vv()
    }
    fn export_since(&self, base: &VersionVector) -> Result<Vec<u8>, Error> {
        self.effect("export")?;
        Ok(self.doc.export(ExportMode::updates(base)).unwrap())
    }
    fn notify_all(&self, update: &[u8]) -> Result<(), Error> {
        let first = self.effect("send-first");
        let last = self.effect("send-last");
        first?;
        last?;
        self.sent.borrow_mut().push(update.into());
        Ok(())
    }
    async fn persist_debt(&self, next: Option<&FanoutDebt>) -> Result<(), Error> {
        if next.is_some() {
            self.effect("advance")?;
        } else {
            self.effect("delete-legacy")?;
            self.effect("delete-modern")?;
        }
        *self.debt.borrow_mut() = next.cloned();
        Ok(())
    }
}
fn updates() -> (Vec<u8>, Vec<u8>) {
    let doc = LoroDoc::new();
    doc.set_peer_id(7).unwrap();
    doc.get_text("content").insert(0, "parent").unwrap();
    doc.commit();
    let parent = doc.export(ExportMode::all_updates()).unwrap();
    let base = doc.oplog_vv();
    doc.get_text("content").insert(6, "child").unwrap();
    let child = doc.export(ExportMode::updates(&base)).unwrap();
    (parent, child)
}

#[test]
fn ordinary_update_and_no_debt_delivery_add_no_notification_storage_work() {
    let room = Room::default();
    block_on(append(&room, &updates().0)).unwrap();
    block_on(release(&room)).unwrap();
    assert_eq!(*room.events.borrow(), ["pending", "archive"]);
    assert_eq!(room.with_pending(|state| state.applied_keys().count()), 1);
}

#[test]
fn resolved_history_is_durable_before_every_reader_and_then_retires_debt() {
    let (parent, child) = updates();
    let room = Room::default();
    block_on(append(&room, &child)).unwrap();
    assert_eq!(room.with_pending(|state| state.applied_keys().count()), 0);
    room.events.borrow_mut().clear();
    block_on(append(&room, &parent)).unwrap();
    assert_eq!(room.with_pending(|state| state.applied_keys().count()), 2);
    block_on(release(&room)).unwrap();
    assert_eq!(
        *room.events.borrow(),
        [
            "intent",
            "pending",
            "archive",
            "export",
            "send-first",
            "send-last",
            "delete-legacy",
            "delete-modern"
        ]
    );
    let reader = LoroDoc::new();
    reader.import(&room.sent.borrow()[0]).unwrap();
    assert_eq!(reader.get_deep_value(), room.doc.get_deep_value());
    assert_eq!(reader.oplog_vv(), room.doc.oplog_vv());
    let events = room.events.borrow().clone();
    block_on(release(&room)).unwrap();
    assert_eq!(*room.events.borrow(), events);
}

#[test]
fn failures_and_cold_retry_preserve_pending_history_and_delivery_debt() {
    let (parent, child) = updates();
    for failure in [
        "intent",
        "pending",
        "archive",
        "send-first",
        "send-last",
        "delete-legacy",
        "delete-modern",
    ] {
        let room = Room::default();
        block_on(append(&room, &child)).unwrap();
        room.fail.set(Some(failure));
        let result = block_on(async {
            append(&room, &parent).await?;
            release(&room).await
        });
        assert!(result.is_err(), "{failure}");
        assert!(
            !room.rows.borrow().is_empty(),
            "acknowledged child survives {failure}"
        );
        if failure != "intent" {
            assert!(room.debt.borrow().is_some(), "{failure}");
        }
        if failure.starts_with("send-") {
            assert!(room.events.borrow().ends_with(&["send-first", "send-last"]));
            assert!(room.state.borrow().debt.is_some());
        }
        let cold = room.cold();
        block_on(append(&cold, &parent)).unwrap();
        block_on(release(&cold)).unwrap();
        assert_eq!(cold.doc.get_text("content").to_string(), "parentchild");
        assert!(cold.debt.borrow().is_none());
        assert!(cold.state.borrow().debt.is_none());
    }
}

#[test]
fn partial_durable_progress_advances_base_but_keeps_missing_required_history() {
    let (parent, child) = updates();
    let room = Room::default();
    block_on(append(&room, &child)).unwrap();
    room.fail.set(Some("pending"));
    assert!(block_on(append(&room, &parent)).is_err());
    let cold = room.cold();
    let independent = LoroDoc::new();
    independent.set_peer_id(8).unwrap();
    independent.get_map("other").insert("value", 1).unwrap();
    block_on(append(
        &cold,
        &independent.export(ExportMode::all_updates()).unwrap(),
    ))
    .unwrap();
    block_on(release(&cold)).unwrap();
    let debt = cold.debt.borrow().clone().unwrap();
    let (base, required) = debt.vectors().unwrap();
    assert_eq!(base, cold.doc.oplog_vv());
    assert!(required.includes_vv(&base));
    assert!(
        required.includes_vv(
            &LoroDoc::decode_import_blob_meta(&child, false)
                .unwrap()
                .partial_end_vv
        )
    );
    assert!(!base.includes_vv(&required));
    assert_eq!(cold.events.borrow().last(), Some(&"advance"));
    block_on(append(&cold, &parent)).unwrap();
    block_on(release(&cold)).unwrap();
    assert!(cold.debt.borrow().is_none());
}

#[test]
fn update_result_keeps_the_original_pre_delivery_revision_and_export_order() {
    let room = Room::default();
    let (parent, child) = updates();
    block_on(append(&room, &child)).unwrap();
    block_on(append(&room, &parent)).unwrap();
    room.events.borrow_mut().clear();
    let expected = room.doc.oplog_vv().encode();
    assert_eq!(
        block_on(release_with_revision(&room)).unwrap(),
        Some(expected)
    );
    assert_eq!(
        *room.events.borrow(),
        [
            "export",
            "export",
            "send-first",
            "send-last",
            "delete-legacy",
            "delete-modern"
        ]
    );
}

#[test]
fn invalid_debt_or_missing_base_retains_debt_without_export_send_or_write() {
    for debt in [
        FanoutDebt {
            base: vec![255],
            required: vec![255],
        },
        FanoutDebt {
            base: VersionVector::from_iter([(7, 1)]).encode(),
            required: VersionVector::from_iter([(7, 2)]).encode(),
        },
    ] {
        let room = Room::default();
        room.with_pending(|state| state.restore_debt(Some(debt.clone())));
        assert!(block_on(release(&room)).is_err());
        assert!(room.events.borrow().is_empty());
        assert_eq!(room.state.borrow().debt, Some(debt));
    }
}
