use crate::*;
use serde_json::{Value, json};
use std::{
    cell::{Cell, RefCell},
    sync::{
        Arc, Barrier, OnceLock,
        atomic::{AtomicUsize, Ordering},
        mpsc,
    },
    time::Duration,
};

thread_local! {
    static SNAPSHOT: RefCell<Option<EditorState>> = const { RefCell::new(None) };
    static REENTERED: Cell<bool> = const { Cell::new(false) };
    static ROLE: Cell<u8> = const { Cell::new(0) };
}
struct SnapshotScope(Option<EditorState>);
impl SnapshotScope {
    fn new(state: &EditorState) -> Self {
        Self(SNAPSHOT.with(|slot| slot.replace(Some(state.clone()))))
    }
}
impl Drop for SnapshotScope {
    fn drop(&mut self) {
        SNAPSHOT.with(|slot| slot.replace(self.0.take()));
        REENTERED.set(false);
    }
}
fn snapshot() -> EditorState {
    SNAPSHOT.with(|slot| {
        slot.borrow()
            .as_ref()
            .expect("actual editor snapshot")
            .clone()
    })
}
fn editor(raw: Value) -> Result<Editor, Box<dyn std::error::Error>> {
    Ok(Editor::builder(EditorMode::Headless)
        .initial_state(serde_json::from_value(json!({"root": {
            "type": "root", "version": 1, "$": raw,
            "children": [{"type":"paragraph", "version":1,"children":[
                {"type":"text","version":1,"text":"content"}
            ]}]
        }}))?)
        .build()?)
}
fn names(state: &EditorState) -> Vec<&'static str> {
    state
        .view()
        .node(NodeKey::ROOT)
        .and_then(NodeRef::node_state)
        .expect("imported state")
        .known_names()
        .collect()
}

static PARSES: AtomicUsize = AtomicUsize::new(0);
static CANONICAL: StateKey<Arc<Value>> = StateKey::new("canonical", |value| {
    value.map_or_else(
        || Arc::new(Value::Null),
        |value| {
            PARSES.fetch_add(1, Ordering::SeqCst);
            Arc::new(json!({"parsed": value}))
        },
    )
});
static OTHER: StateKey<u32> = StateKey::new("other", |value| {
    value
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or(0)
});
#[test]
fn read_memo_is_shared_without_a_write_and_copied_on_the_first_real_write()
-> Result<(), Box<dyn std::error::Error>> {
    PARSES.store(0, Ordering::SeqCst);
    let mut editor = editor(json!({"canonical":{"raw":true}}))?;
    let before = editor.state().clone();
    let ((first, second), commit) = editor.update(|tx| {
        Ok((
            tx.get_state(NodeKey::ROOT, &CANONICAL)?,
            tx.get_state(NodeKey::ROOT, &CANONICAL)?,
        ))
    })?;
    assert!(commit.is_noop());
    assert!(Arc::ptr_eq(&first, &second));
    assert_eq!(PARSES.load(Ordering::SeqCst), 1);
    assert!(Arc::ptr_eq(
        before.nodes.get(&NodeKey::ROOT).expect("root"),
        editor.state().nodes.get(&NodeKey::ROOT).expect("root"),
    ));
    assert_eq!(names(&before), vec!["canonical"]);
    assert_eq!(before.to_json()?, editor.state().to_json()?);
    assert_eq!(
        editor.state().to_json()?.root["$"]["canonical"],
        json!({"parsed":{"raw":true}})
    );
    // Keep the direct JSON writer on memo-aware state, including later optimized writers.
    let streamed: Value = serde_json::from_str(&before.to_json_string()?)?;
    assert_eq!(
        streamed["root"]["$"]["canonical"],
        json!({"parsed":{"raw":true}})
    );
    assert!(
        before
            .view()
            .node(NodeKey::ROOT)
            .and_then(NodeRef::node_state)
            .and_then(NodeState::unknown)
            .expect("retained raw slot")
            .contains_key("canonical")
    );
    editor.update(|tx| tx.set_state(NodeKey::ROOT, &OTHER, 5))?;
    let copied = editor.state().view().get_state(NodeKey::ROOT, &CANONICAL)?;
    assert!(Arc::ptr_eq(&first, &copied));
    assert_eq!(PARSES.load(Ordering::SeqCst), 1);
    assert_eq!(names(editor.state()), vec!["canonical", "other"]);
    assert_eq!(names(&before), vec!["canonical"]);
    Ok(())
}

static ABSENT: StateKey<u32> = StateKey::new("absent", |_| 7);
#[test]
fn absent_reads_return_the_default_without_materializing_a_known_entry()
-> Result<(), Box<dyn std::error::Error>> {
    let editor = editor(json!({"untouched":1}))?;
    let before = editor.state().to_json()?;
    assert_eq!(editor.state().view().get_state(NodeKey::ROOT, &ABSENT)?, 7);
    assert!(names(editor.state()).is_empty());
    assert_eq!(editor.state().to_json()?, before);
    Ok(())
}

static NESTED_B: StateKey<Arc<Value>> = StateKey::new("nested-b", |value| {
    Arc::new(value.cloned().unwrap_or(Value::Null))
});
static NESTED_A: StateKey<Arc<Value>> = StateKey::new("nested-a", |value| {
    if value.is_none() {
        return Arc::new(Value::Null);
    }
    let state = snapshot();
    let b = state
        .view()
        .get_state(NodeKey::ROOT, &NESTED_B)
        .expect("nested B read");
    Arc::new(json!({"b":b.as_ref()}))
});
#[test]
fn nested_other_key_reads_publish_in_completion_order() -> Result<(), Box<dyn std::error::Error>> {
    let editor = editor(json!({"nested-a":1,"nested-b":2}))?;
    let _scope = SnapshotScope::new(editor.state());
    let a = editor.state().view().get_state(NodeKey::ROOT, &NESTED_A)?;
    assert_eq!(a.as_ref(), &json!({"b":2}));
    assert_eq!(names(editor.state()), vec!["nested-b", "nested-a"]);
    Ok(())
}

static SAME_KEY: StateKey<Arc<Value>> = StateKey::new("same-key", |value| {
    if value.is_none() {
        return Arc::new(Value::Null);
    }
    if REENTERED.replace(true) {
        return Arc::new(json!("inner"));
    }
    let state = snapshot();
    assert_eq!(
        state
            .view()
            .get_state(NodeKey::ROOT, &SAME_KEY)
            .expect("same-key nested read")
            .as_ref(),
        &json!("inner")
    );
    REENTERED.set(false);
    Arc::new(json!("outer"))
});
#[test]
fn same_key_reentry_overwrites_the_nested_value_without_reordering()
-> Result<(), Box<dyn std::error::Error>> {
    let editor = editor(json!({"same-key":1}))?;
    let _scope = SnapshotScope::new(editor.state());
    let first = editor.state().view().get_state(NodeKey::ROOT, &SAME_KEY)?;
    assert_eq!(first.as_ref(), &json!("outer"));
    assert!(Arc::ptr_eq(
        &first,
        &editor.state().view().get_state(NodeKey::ROOT, &SAME_KEY)?
    ));
    assert_eq!(names(editor.state()), vec!["same-key"]);
    Ok(())
}

static CHAIN_A: StateKey<Arc<Value>> = StateKey::new("chain-a", |value| {
    if value.is_none() {
        return Arc::new(Value::Null);
    }
    if REENTERED.replace(true) {
        return Arc::new(json!("inner-a"));
    }
    let state = snapshot();
    assert_eq!(
        state
            .view()
            .get_state(NodeKey::ROOT, &CHAIN_B)
            .expect("B read")
            .as_ref(),
        &json!("b")
    );
    REENTERED.set(false);
    Arc::new(json!("outer-a"))
});
static CHAIN_B: StateKey<Arc<Value>> = StateKey::new("chain-b", |value| {
    if value.is_none() {
        return Arc::new(Value::Null);
    }
    let state = snapshot();
    assert_eq!(
        state
            .view()
            .get_state(NodeKey::ROOT, &CHAIN_A)
            .expect("inner A read")
            .as_ref(),
        &json!("inner-a")
    );
    Arc::new(json!("b"))
});
#[test]
fn cyclic_key_reentry_finishes_and_keeps_the_nested_insertion_position()
-> Result<(), Box<dyn std::error::Error>> {
    let editor = editor(json!({"chain-a":1,"chain-b":2}))?;
    let _scope = SnapshotScope::new(editor.state());
    let a = editor.state().view().get_state(NodeKey::ROOT, &CHAIN_A)?;
    assert_eq!(a.as_ref(), &json!("outer-a"));
    assert_eq!(names(editor.state()), vec!["chain-a", "chain-b"]);
    Ok(())
}

static ATTEMPTS: AtomicUsize = AtomicUsize::new(0);
static RETRY: StateKey<Arc<Value>> = StateKey::new("retry", |value| {
    if value.is_none() {
        return Arc::new(Value::Null);
    }
    if ATTEMPTS.fetch_add(1, Ordering::SeqCst) == 0 {
        panic!("parser retry control");
    }
    Arc::new(json!("retried"))
});
#[test]
fn parser_panic_does_not_publish_a_value_or_poison_the_retry()
-> Result<(), Box<dyn std::error::Error>> {
    ATTEMPTS.store(0, Ordering::SeqCst);
    let editor = editor(json!({"retry":1}))?;
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| editor
            .state()
            .view()
            .get_state(NodeKey::ROOT, &RETRY)))
        .is_err()
    );
    assert!(names(editor.state()).is_empty());
    let retried = editor.state().view().get_state(NodeKey::ROOT, &RETRY)?;
    assert_eq!(retried.as_ref(), &json!("retried"));
    assert!(Arc::ptr_eq(
        &retried,
        &editor.state().view().get_state(NodeKey::ROOT, &RETRY)?
    ));
    assert_eq!(ATTEMPTS.load(Ordering::SeqCst), 2);
    Ok(())
}

struct Concurrent {
    entered: mpsc::Sender<u8>,
    first: Barrier,
    second: Barrier,
}
static CONCURRENT: OnceLock<Concurrent> = OnceLock::new();
static RACING: StateKey<Arc<Value>> = StateKey::new("racing", |value| {
    if value.is_none() {
        return Arc::new(Value::Null);
    }
    let control = CONCURRENT.get().expect("concurrent parser controls");
    let role = ROLE.get();
    control.entered.send(role).expect("report parser entry");
    if role == 0 {
        control.first.wait();
    } else {
        control.second.wait();
    }
    Arc::new(json!(role))
});
#[test]
fn concurrent_readers_reuse_the_first_published_typed_arc() -> Result<(), Box<dyn std::error::Error>>
{
    let state = Arc::new(editor(json!({"racing":1}))?.state().clone());
    let (entered_tx, entered_rx) = mpsc::channel();
    assert!(
        CONCURRENT
            .set(Concurrent {
                entered: entered_tx,
                first: Barrier::new(2),
                second: Barrier::new(2)
            })
            .is_ok()
    );
    let (completed_tx, completed_rx) = mpsc::channel();
    let readers: Vec<_> = (0..2)
        .map(|role| {
            let state = state.clone();
            let completed = completed_tx.clone();
            std::thread::spawn(move || {
                ROLE.set(role);
                let value = state
                    .view()
                    .get_state(NodeKey::ROOT, &RACING)
                    .expect("concurrent read");
                completed
                    .send((role, value))
                    .expect("report completed read");
            })
        })
        .collect();
    let timeout = Duration::from_secs(10);
    let mut entered = [
        entered_rx.recv_timeout(timeout)?,
        entered_rx.recv_timeout(timeout)?,
    ];
    entered.sort();
    assert_eq!(entered, [0, 1]);
    let control = CONCURRENT.get().expect("concurrent controls");
    control.first.wait();
    let (role, first) = completed_rx.recv_timeout(timeout)?;
    assert_eq!(role, 0);
    control.second.wait();
    let (role, second) = completed_rx.recv_timeout(timeout)?;
    assert_eq!(role, 1);
    assert_eq!(first.as_ref(), &json!(0));
    assert!(Arc::ptr_eq(&first, &second));
    for reader in readers {
        reader.join().expect("reader thread");
    }
    assert_eq!(names(&state), vec!["racing"]);
    Ok(())
}

#[derive(Clone, Debug)]
struct ExportReadsSibling(bool);
impl StateValue for ExportReadsSibling {
    fn to_json(&self) -> Value {
        if self.0 {
            snapshot()
                .view()
                .get_state(NodeKey::ROOT, &EXPORT_SIBLING)
                .expect("serializer sibling read");
        }
        json!(self.0)
    }
    fn js_equal(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}
static EXPORT_SIBLING: StateKey<u32> = StateKey::new("export-b", |value| {
    value.and_then(Value::as_u64).map_or(0, |value| {
        u32::try_from(value).expect("small source value") + 1
    })
});
static EXPORT_READER: StateKey<ExportReadsSibling> = StateKey::new("export-a", |value| {
    ExportReadsSibling(value.and_then(Value::as_bool).unwrap_or(false))
});
#[test]
fn serializers_can_read_another_key_and_the_live_export_visits_it()
-> Result<(), Box<dyn std::error::Error>> {
    let editor = editor(json!({"export-a":true,"export-b":0}))?;
    let _scope = SnapshotScope::new(editor.state());
    editor
        .state()
        .view()
        .get_state(NodeKey::ROOT, &EXPORT_READER)?;
    // The serializer's sibling read must be visible within this same streaming export.
    let streamed: Value = serde_json::from_str(&editor.state().to_json_string()?)?;
    assert_eq!(streamed["root"]["$"]["export-b"], json!(1));
    let output = editor.state().to_json()?;
    assert_eq!(output.root["$"]["export-a"], json!(true));
    assert_eq!(output.root["$"]["export-b"], json!(1));
    assert_eq!(names(editor.state()), vec!["export-a", "export-b"]);
    Ok(())
}

static LIVE_A: StateKey<u32> = StateKey::new("live-a", |_| 1);
static LIVE_B: StateKey<u32> = StateKey::new("live-b", |_| 2);
static LIVE_C: StateKey<u32> = StateKey::new("live-c", |_| 3);
#[test]
fn known_names_iterate_live_entries_but_stay_finished_after_exhaustion()
-> Result<(), Box<dyn std::error::Error>> {
    let editor = editor(json!({"live-a":1,"live-b":2,"live-c":3}))?;
    let state = editor
        .state()
        .view()
        .node(NodeKey::ROOT)
        .and_then(NodeRef::node_state)
        .expect("imported state");
    let mut names = state.known_names();
    editor.state().view().get_state(NodeKey::ROOT, &LIVE_A)?;
    assert_eq!(names.next(), Some("live-a"));
    editor.state().view().get_state(NodeKey::ROOT, &LIVE_B)?;
    assert_eq!(names.next(), Some("live-b"));
    assert_eq!(names.next(), None);
    editor.state().view().get_state(NodeKey::ROOT, &LIVE_C)?;
    assert_eq!(names.next(), None);
    Ok(())
}

static COLLISION_FIRST: StateKey<u32> = StateKey::new("memo-collision", |_| 1);
static COLLISION_PARSES: AtomicUsize = AtomicUsize::new(0);
static COLLISION_SECOND: StateKey<u32> = StateKey::new("memo-collision", |value| {
    if value.is_some() {
        COLLISION_PARSES.fetch_add(1, Ordering::SeqCst);
    }
    2
});
#[test]
fn another_config_for_a_claimed_key_is_rejected_before_its_parser()
-> Result<(), Box<dyn std::error::Error>> {
    COLLISION_PARSES.store(0, Ordering::SeqCst);
    let editor = editor(json!({"memo-collision":3}))?;
    assert_eq!(
        editor
            .state()
            .view()
            .get_state(NodeKey::ROOT, &COLLISION_FIRST)?,
        1
    );
    assert!(matches!(
        editor
            .state()
            .view()
            .get_state(NodeKey::ROOT, &COLLISION_SECOND),
        Err(Error::StateKeyCollision {
            key: "memo-collision"
        })
    ));
    assert_eq!(COLLISION_PARSES.load(Ordering::SeqCst), 0);
    assert_eq!(names(editor.state()), vec!["memo-collision"]);
    Ok(())
}
