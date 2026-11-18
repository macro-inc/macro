use super::*;
use lexical_model::{Editor, EditorMode, ElementFormat, Paragraph, StateKey, StateValue};
use loro::LoroValue;
use serde_json::{Value, json};
use std::cell::RefCell;

static PLAIN: PlainPolicy = PlainPolicy;

#[test]
fn bind_validates_state_without_materializing_json_maps() -> Result<()> {
    let doc = new_doc(7)?;
    let map = doc.get_map("root");
    map.insert("type", "paragraph")?;
    map.insert(
        "$",
        schema::to_loro(&json!({
            "id":"段落😀", "probe":{"nested":[true, null, {"value":"kept"}]}
        })),
    )?;
    let mut index = NodeIndex::default();
    let maps = schema::test::JsonMaps::begin();
    index.bind(NodeKey::ROOT, &map, &PLAIN)?;
    assert_eq!(index.nodes[&NodeKey::ROOT].id.as_deref(), Some("段落😀"));
    assert_eq!(
        maps.count(),
        0,
        "binding must not construct serde JSON maps"
    );
    Ok(())
}

#[test]
fn bind_state_ids_and_nonfinite_doubles_keep_existing_admissibility() -> Result<()> {
    let doc = new_doc(7)?;
    let map = doc.get_map("root");
    map.insert("type", "paragraph")?;
    let mut index = NodeIndex::default();
    for (state, expected) in [
        (json!({"id":""}), Some("")),
        (json!({"id":"段落😀"}), Some("段落😀")),
        (json!({"id":42}), None),
        (json!({"id":null}), None),
        (json!({"id":{"nested":"not an id"}}), None),
        (json!({"other":"kept"}), None),
    ] {
        map.insert("$", schema::to_loro(&state))?;
        index.bind(NodeKey::ROOT, &map, &PLAIN)?;
        assert_eq!(index.nodes[&NodeKey::ROOT].id.as_deref(), expected);
        assert_eq!(index.ids.len(), usize::from(expected.is_some()));
    }
    for double in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -0.0] {
        let state = LoroValue::Map(
            vec![
                ("id".into(), LoroValue::String("kept".into())),
                ("number".into(), LoroValue::Double(double)),
            ]
            .into(),
        );
        assert!(schema::from_loro(&state).is_ok());
        map.insert("$", state)?;
        index.bind(NodeKey::ROOT, &map, &PLAIN)?;
        assert_eq!(index.nodes[&NodeKey::ROOT].id.as_deref(), Some("kept"));
    }
    Ok(())
}

#[test]
fn invalid_nested_state_does_not_mutate_any_index_or_stop_at_id() -> Result<()> {
    let doc = new_doc(7)?;
    let map = doc.get_map("root");
    map.insert("type", "paragraph")?;
    let state = map.insert_container("$", LoroMap::new())?;
    state.insert("id", "old")?;
    state
        .insert_container("nested", LoroMap::new())?
        .insert("valid", true)?;
    let mut index = NodeIndex::default();
    index.bind(NodeKey::ROOT, &map, &PLAIN)?;
    let nodes = index.nodes.clone();
    let owner = index.owner.clone();
    let ids = index.ids.clone();
    let owned = index.owned.clone();
    let replacement = doc.get_map("replacement");
    replacement.insert("type", "paragraph")?;
    let replacement_state = replacement.insert_container("$", LoroMap::new())?;
    replacement_state.insert("id", "new")?;
    replacement_state.insert(
        "nested",
        LoroValue::List(
            vec![
                LoroValue::Bool(true),
                LoroValue::Map(
                    vec![("invalid".into(), LoroValue::Binary(vec![1, 2, 3].into()))].into(),
                ),
            ]
            .into(),
        ),
    )?;
    assert!(matches!(
        index.bind(NodeKey::ROOT, &replacement, &PLAIN),
        Err(ProjectionError::Schema { path }) if path == "non-JSON value"
    ));
    assert_eq!(index.owner, owner);
    assert_eq!(index.ids, ids);
    assert_eq!(index.owned, owned);
    assert_eq!(index.nodes.len(), nodes.len());
    for ((key, actual), (old_key, old)) in index.nodes.iter().zip(nodes.iter()) {
        assert_eq!(key, old_key);
        assert_eq!(actual.map, old.map);
        assert_eq!(actual.state, old.state);
        assert_eq!(actual.ids, old.ids);
        assert_eq!(actual.text, old.text);
        assert_eq!(actual.children, old.children);
        assert_eq!(actual.plain_composite, old.plain_composite);
        assert_eq!(actual.id, old.id);
    }
    Ok(())
}

thread_local! {
    static EXPORTS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
    static MUTATE_DURING_EXPORT: RefCell<Option<LoroMap>> = const { RefCell::new(None) };
}
struct ExportMutation(Option<LoroMap>);
impl ExportMutation {
    fn begin(map: LoroMap) -> Self {
        Self(MUTATE_DURING_EXPORT.replace(Some(map)))
    }
}
impl Drop for ExportMutation {
    fn drop(&mut self) {
        MUTATE_DURING_EXPORT.set(self.0.take());
    }
}
#[derive(Clone, Debug)]
struct ExportProbe(String);
impl StateValue for ExportProbe {
    fn to_json(&self) -> Value {
        EXPORTS.with_borrow_mut(|values| values.push(self.0.clone()));
        MUTATE_DURING_EXPORT.with_borrow(|map| {
            if let Some(map) = map {
                map.insert("text", LoroValue::Null)
                    .expect("captured Loro mutation");
            }
        });
        Value::String(self.0.clone())
    }
    fn js_equal(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}
static PROBE: StateKey<ExportProbe> = StateKey::new("probe", |value| {
    ExportProbe(value.and_then(Value::as_str).unwrap_or_default().to_owned())
});

#[test]
fn local_bind_keeps_actual_export_callback_order_and_count() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let (paragraph, _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        tx.set_state(paragraph, &PROBE, ExportProbe("kept".into()))?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(paragraph)
    })?;
    let doc = new_doc(7)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    let (_, commit) = editor.update(|tx| {
        tx.element(paragraph)?.set_format(ElementFormat::Center)?;
        Ok(())
    })?;
    EXPORTS.with_borrow_mut(Vec::clear);
    projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, 1)?;
    assert_eq!(
        EXPORTS.with_borrow(|values| values.clone()),
        ["kept", "kept"]
    );
    projection
        .check(&doc, editor.state())
        .expect("strict projection");

    // A readonly model callback can still hold and mutate the real Loro document.
    let paragraph_map = projection.index.map(&doc, paragraph.key())?;
    let owner = projection.index.owner.clone();
    let ids = projection.index.ids.clone();
    let owned = projection.index.owned.clone();
    let bound_map = projection.index.nodes[&paragraph.key()].map.clone();
    let (_, commit) = editor.update(|tx| {
        tx.element(paragraph)?.set_format(ElementFormat::Right)?;
        Ok(())
    })?;
    EXPORTS.with_borrow_mut(Vec::clear);
    let _mutation = ExportMutation::begin(paragraph_map.clone());
    assert!(matches!(
        projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, 2),
        Err(ProjectionError::Schema { path }) if path == "text"
    ));
    assert_eq!(
        EXPORTS.with_borrow(|values| values.clone()),
        ["kept", "kept"]
    );
    assert_eq!(projection.index.owner, owner);
    assert_eq!(projection.index.ids, ids);
    assert_eq!(projection.index.owned, owned);
    assert_eq!(projection.index.nodes[&paragraph.key()].map, bound_map);
    assert!(matches!(
        paragraph_map.get("text"),
        Some(ValueOrContainer::Value(LoroValue::Null))
    ));
    Ok(())
}

// Concurrent moves by two Source peers can leave two live maps with one `$.id`; when the
// first claimant is unbound, the survivor must take over the id.
#[test]
fn unbinding_the_first_claimant_of_a_duplicate_id_rebinds_the_survivor() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let ((first, second), _) = editor
        .update(|tx| {
            let first = tx.create(Paragraph::default())?;
            let second = tx.create(Paragraph::default())?;
            Ok((first.key(), second.key()))
        })
        .expect("nodes");
    let doc = new_doc(7)?;
    let mut index = NodeIndex::default();
    for (name, key) in [("first", first), ("second", second)] {
        let map = doc.get_map(name);
        map.insert("type", "paragraph")?;
        map.insert("$", schema::to_loro(&json!({"id":"shared"})))?;
        index.bind(key, &map, &PLAIN)?;
    }
    assert_eq!(index.ids.get("shared"), Some(&first));
    index.unbind(first);
    assert_eq!(index.ids.get("shared"), Some(&second));
    index.unbind(second);
    assert_eq!(index.ids.get("shared"), None);
    Ok(())
}

// Projection refreshes rebind a node to its map with the same id; that must not hand the
// id to another claimant. Only an unbind or an id change releases the claim, and a
// removed non-primary claimant must never be promoted later.
#[test]
fn rebinding_a_claimant_with_the_same_id_keeps_its_claim() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let ((first, second, third), _) = editor
        .update(|tx| {
            let first = tx.create(Paragraph::default())?;
            let second = tx.create(Paragraph::default())?;
            let third = tx.create(Paragraph::default())?;
            Ok((first.key(), second.key(), third.key()))
        })
        .expect("nodes");
    let doc = new_doc(7)?;
    let maps = [("first", first), ("second", second), ("third", third)].map(|(name, key)| {
        let map = doc.get_map(name);
        map.insert("type", "paragraph").expect("type");
        map.insert("$", schema::to_loro(&json!({"id":"shared"})))
            .expect("state");
        (map, key)
    });
    let mut index = NodeIndex::default();
    for (map, key) in &maps {
        index.bind(*key, map, &PLAIN)?;
    }
    index.bind(first, &maps[0].0, &PLAIN)?;
    index.bind(second, &maps[1].0, &PLAIN)?;
    assert_eq!(index.ids.get("shared"), Some(&first));
    index.unbind(second);
    index.unbind(first);
    assert_eq!(index.ids.get("shared"), Some(&third));
    maps[2]
        .0
        .insert("$", schema::to_loro(&json!({"id":"moved"})))?;
    index.bind(third, &maps[2].0, &PLAIN)?;
    assert_eq!(index.ids.get("shared"), None);
    assert_eq!(index.ids.get("moved"), Some(&third));
    Ok(())
}
