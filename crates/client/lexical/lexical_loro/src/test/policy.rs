use super::*;
use crate::policy::synced_owner;
static LOCAL: StateKey<std::sync::Arc<serde_json::Value>> = StateKey::new("local", |v| {
    std::sync::Arc::new(v.cloned().unwrap_or_default())
});
struct Filter;
static FILTER: Filter = Filter;
impl SyncPolicy for Filter {
    fn is_dropped(&self, view: StateRef<'_>, key: NodeKey) -> bool {
        view.get_state(key, &ID).is_ok_and(|id| id == "drop")
    }
    fn is_transparent(&self, view: StateRef<'_>, key: NodeKey) -> bool {
        view.get_state(key, &ID).is_ok_and(|id| id == "wrap")
    }
    fn is_dropped_json(&self, node: &SerializedNode) -> bool {
        node.get("$")
            .and_then(|v| v.get("id"))
            .and_then(serde_json::Value::as_str)
            == Some("drop")
    }
    fn is_transparent_json(&self, node: &SerializedNode) -> bool {
        node.get("$")
            .and_then(|v| v.get("id"))
            .and_then(serde_json::Value::as_str)
            == Some("wrap")
    }
    fn local_state_keys(&self) -> &'static [&'static str] {
        &["local"]
    }
    fn ignore_in_remote_compare(&self, _: &str, _: &SerializedNode) -> &'static [&'static str] {
        &["style"]
    }
    fn keep_local_on_remote(&self, _: &str) -> &'static [&'static str] {
        &["style"]
    }
}
#[test]
fn local_state_is_masked_and_dropped_subtrees_and_transparent_wrappers_are_filtered() -> Result<()>
{
    let plain_doc = new_doc(3)?;
    let plain = plain_doc.get_map("root");
    plain.insert("$", schema::to_loro(&json!({"local":{"only":true}})))?;
    assert!(!schema::has_plain_composites(&plain, &FILTER));
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let ((wrapper, text, dropped), _) = editor.update(|tx| {
        let wrapper = tx.create(Paragraph::default())?;
        let text = tx.create_text("visible")?;
        let dropped = tx.create(Paragraph::default())?;
        let hidden = tx.create_text("hidden")?;
        tx.set_state(wrapper, &ID, "wrap".into())?;
        tx.set_state(text, &ID, "text".into())?;
        tx.set_state(text, &LOCAL, json!({"selection":1}).into())?;
        tx.set_state(dropped, &ID, "drop".into())?;
        tx.append(wrapper, &[text.key()])?;
        tx.append(dropped, &[hidden.key()])?;
        tx.append(NodeKey::ROOT, &[wrapper.key(), dropped.key()])?;
        tx.text(text)?
            .select(Some(Utf16Offset(2)), Some(Utf16Offset(2)))?;
        Ok((wrapper, text, dropped))
    })?;
    let doc = new_doc(1)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &FILTER, 0)?;
    assert!(projection.container_of(wrapper.key()).is_none());
    assert!(projection.container_of(dropped.key()).is_none());
    assert_eq!(
        reconstruct_state(&doc, &FILTER)?.root["children"]
            .as_array()
            .expect("children")
            .len(),
        1
    );
    projection.check(&doc, editor.state()).expect("filtered");
    let map = projection.index.map(&doc, text.key())?;
    let state = schema::map_at(map.get("$"), "$")?;
    state.insert("local", schema::to_loro(&json!({"retained":true})))?;
    doc.commit_with(loro::CommitOptions::new().origin(LOCAL_ORIGIN).timestamp(1));
    let (_, commit) =
        editor.update(|tx| tx.set_state(text, &LOCAL, json!({"selection":2}).into()))?;
    assert!(
        !projection
            .local_commit(&doc, &[commit], LOCAL_ORIGIN, 2)?
            .changed
    );
    for i in 0..3 {
        let (_, commit) = editor.update(|tx| {
            tx.text(text)?
                .set_text_content(&format!("visible{i}"))
                .map(|_| ())
        })?;
        let result = projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, i + 3)?;
        assert!(result.stats.nodes_visited <= 2, "{:?}", result.stats);
        assert!(!projection.index.nodes[&text.key()].plain_composite);
    }
    assert_eq!(
        schema::read_value(&state.get("local").expect("local"))?,
        json!({"retained":true})
    );
    projection
        .check(&doc, editor.state())
        .expect("filtered after edits");
    let cursors = projection
        .cursor(
            &doc,
            editor.state(),
            editor.state().selection().expect("selection"),
        )
        .expect("cursors");
    // Current policy wins over an index left from the previous committed view.
    editor.update(|tx| tx.set_state(text, &ID, "drop".into()))?;
    assert_eq!(
        synced_owner(editor.state().view(), text.key(), &FILTER),
        None
    );
    assert!(
        projection
            .cursor(
                &doc,
                editor.state(),
                editor.state().selection().expect("selection")
            )
            .is_none()
    );
    assert!(
        projection
            .point(&doc, editor.state(), &cursors.anchor)
            .is_none()
    );
    Ok(())
}

#[test]
fn native_transparent_wrapper_events_and_visibility_transitions_reconcile_the_synced_parent()
-> Result<()> {
    let doc = new_doc(1)?;
    let root = doc.get_map("root");
    schema::initialize_map(&root,json!({"type":"root","version":1,"format":"","indent":0,"direction":null,"children":[{"type":"paragraph","version":1,"format":"","indent":0,"direction":null,"textFormat":0,"textStyle":"","$":{"id":"outer"},"children":[{"type":"paragraph","version":1,"format":"","indent":0,"direction":null,"textFormat":0,"textStyle":"","$":{"id":"wrap"},"children":[{"type":"text","version":1,"format":0,"detail":0,"mode":"normal","style":"","text":"visible","$":{"id":"a"}}]}]}]}).as_object().expect("root"),schema::MapSchema::Node)?;
    doc.commit_with(loro::CommitOptions::new().origin("peer").timestamp(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let state = editor.parse_editor_state(&reconstruct_state(&doc, &FILTER)?)?;
    editor.set_editor_state(state, TagSet::default())?;
    let mut projection = LoroProjection::attach(&doc, editor.state(), &FILTER)?;
    let outer = schema::map_at(schema::children(&root)?.expect("children").get(0), "outer")?;
    let wrapper = schema::map_at(
        schema::children(&outer)?.expect("children").get(0),
        "wrapper",
    )?;
    let children = schema::children(&wrapper)?.expect("children");
    let new = children.insert_container(1, LoroMap::new())?;
    schema::initialize_map(
        &new,
        json!({"type":"linebreak","version":1,"$":{"id":"b"}})
            .as_object()
            .expect("node"),
        schema::MapSchema::Node,
    )?;
    doc.commit_with(loro::CommitOptions::new().origin("peer").timestamp(1));
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let changes = projection.take_remote(&doc, core.state())?;
    assert_eq!(
        changes
            .changes
            .iter()
            .filter(|c| matches!(c, NodeChange::Create { .. }))
            .count(),
        1
    );
    assert!(!super::peers::apply_remote(&mut projection, &doc, &mut core, changes, 1)?.changed);
    projection
        .check(&doc, core.state())
        .expect("insert below transparent wrapper");
    let old_a = *projection.index.ids.get("a").expect("a");
    let state = schema::map_at(wrapper.get("$"), "$")?;
    state.insert("id", "visible")?;
    doc.commit_with(loro::CommitOptions::new().origin("peer").timestamp(2));
    let changes = projection.take_remote(&doc, core.state())?;
    assert!(!super::peers::apply_remote(&mut projection, &doc, &mut core, changes, 2)?.changed);
    projection
        .check(&doc, core.state())
        .expect("transparent to normal");
    assert_eq!(projection.index.ids.get("a"), Some(&old_a));
    state.insert("id", "wrap")?;
    doc.commit_with(loro::CommitOptions::new().origin("peer").timestamp(3));
    let changes = projection.take_remote(&doc, core.state())?;
    assert!(!super::peers::apply_remote(&mut projection, &doc, &mut core, changes, 3)?.changed);
    projection
        .check(&doc, core.state())
        .expect("normal to transparent");
    assert_eq!(projection.index.ids.get("a"), Some(&old_a));
    // A text event in the same drain as hiding its ancestor is suppressed.
    let amap = schema::map_at(children.get(0), "a")?;
    let Container::Text(text) = amap
        .get("text")
        .expect("text")
        .as_container()
        .expect("container")
        .clone()
    else {
        panic!("text")
    };
    text.insert(0, "hidden-")?;
    state.insert("id", "drop")?;
    doc.commit_with(loro::CommitOptions::new().origin("peer").timestamp(2));
    let changes = projection.take_remote(&doc, core.state())?;
    assert!(!super::peers::apply_remote(&mut projection, &doc, &mut core, changes, 2)?.changed);
    assert!(projection.container_of(old_a).is_none());
    projection
        .check(&doc, core.state())
        .expect("drop native live subtree");
    state.insert("id", "wrap")?;
    doc.commit_with(loro::CommitOptions::new().origin("peer").timestamp(3));
    let changes = projection.take_remote(&doc, core.state())?;
    assert!(!super::peers::apply_remote(&mut projection, &doc, &mut core, changes, 3)?.changed);
    assert_ne!(projection.index.ids.get("a"), Some(&old_a));
    projection
        .check(&doc, core.state())
        .expect("restore visible children");
    let outer_key = *projection.index.ids.get("outer").expect("outer");
    let b = *projection.index.ids.get("b").expect("b");
    let output = core
        .apply(
            Input::ApplyRemote {
                changes: vec![NodeChange::Children {
                    parent: NodeTarget::Key(outer_key),
                    children: vec![NodeTarget::Key(b)],
                }],
                options: UpdateOptions::default(),
            },
            HistoryTime(4),
        )
        .expect("local remove");
    assert!(
        projection
            .local_commit(&doc, &output.commits, LOCAL_ORIGIN, 4)?
            .changed
    );
    assert_eq!(schema::children(&outer)?.expect("children").len(), 1);
    assert!(wrapper.is_deleted());
    projection
        .check(&doc, core.state())
        .expect("local edit below persisted transparent wrapper");
    Ok(())
}

#[test]
fn remote_compare_can_ignore_a_field_and_keep_local_when_other_fields_change() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let (text, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("style")?;
        tx.text(text)?.set_style("local")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(text)
    })?;
    let doc = new_doc(1)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &FILTER, 0)?;
    let map = projection.index.map(&doc, text.key())?;
    map.insert("style", "remote")?;
    doc.commit_with(loro::CommitOptions::new().origin("peer").timestamp(1));
    assert!(
        projection
            .take_remote(&doc, editor.state())?
            .changes
            .is_empty()
    );
    map.insert("format", 1)?;
    doc.commit_with(loro::CommitOptions::new().origin("peer").timestamp(2));
    let changes = projection.take_remote(&doc, editor.state())?;
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    assert!(super::peers::apply_remote(&mut projection, &doc, &mut core, changes, 3)?.changed);
    assert_eq!(
        core.state().view().text(text).expect("text").style.as_ref(),
        "local"
    );
    assert_eq!(
        schema::read_value(&map.get("style").expect("style"))?,
        json!("local")
    );
    projection
        .check(&doc, core.state())
        .expect("local field retained");
    Ok(())
}
