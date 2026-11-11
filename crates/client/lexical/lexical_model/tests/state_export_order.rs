//! Export order is independent of state callback order and type registration.
use lexical_model::*;
use serde_json::Value;
use std::cell::RefCell;

thread_local! { static CALLS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) }; }
#[derive(Clone, Debug)]
struct Probe(String);
impl StateValue for Probe {
    fn to_json(&self) -> Value {
        CALLS.with(|calls| calls.borrow_mut().push(self.0.clone()));
        Value::String(self.0.clone())
    }
    fn js_equal(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}
static A: StateKey<Probe> = StateKey::new("a", |_| Probe(String::new()));
static B: StateKey<Probe> = StateKey::new("b", |_| Probe(String::new()));

#[test]
fn export_policy_does_not_reorder_callbacks_or_other_node_types() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .state_export_order::<Root>(&["b", "absent", "a"])
        .build()
        .expect("editor");
    editor.update(|tx| {
        tx.set_state(NodeKey::ROOT, &A, Probe("root-a".into()))?;
        tx.set_state(NodeKey::ROOT, &B, Probe("root-b".into()))?;
        let p = tx.create(Paragraph::default())?;
        tx.set_state(p, &A, Probe("child-a".into()))?;
        tx.set_state(p, &B, Probe("child-b".into()))?;
        tx.append(NodeKey::ROOT, &[p.key()])
    })?;
    CALLS.with(|calls| calls.borrow_mut().clear());
    let streamed: Value = serde_json::from_str(&editor.state().to_json_string()?)?;
    CALLS.with(|calls| assert_eq!(*calls.borrow(), ["root-a", "root-b", "child-a", "child-b"]));
    assert_eq!(
        streamed["root"]["$"]
            .as_object()
            .expect("root state")
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["b", "a"]
    );
    assert_eq!(
        streamed["root"]["children"][0]["$"]
            .as_object()
            .expect("child state")
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["a", "b"]
    );
    CALLS.with(|calls| calls.borrow_mut().clear());
    let value = serde_json::to_value(editor.state().to_json()?)?;
    CALLS.with(|calls| assert_eq!(*calls.borrow(), ["root-a", "root-b", "child-a", "child-b"]));
    assert_eq!(value.to_string(), streamed.to_string());
    CALLS.with(|calls| calls.borrow_mut().clear());
    let direct = editor.state().view().export_json(NodeKey::ROOT)?;
    CALLS.with(|calls| assert_eq!(*calls.borrow(), ["root-a", "root-b"]));
    assert_eq!(direct["$"].to_string(), streamed["root"]["$"].to_string());
    Ok(())
}

#[test]
fn configured_names_do_not_create_absent_state() -> Result<(), Error> {
    let editor = Editor::builder(EditorMode::Headless)
        .state_export_order::<Root>(&["absent"])
        .build()
        .expect("editor");
    let value: Value = serde_json::from_str(&editor.state().to_json_string()?)?;
    assert!(value["root"].get("$").is_none());
    Ok(())
}
