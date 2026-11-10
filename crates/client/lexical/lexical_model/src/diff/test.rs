use super::*;
#[test]
fn creations_are_parent_first_then_children_then_property_updates() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let ((paragraph, text), commit) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let t = tx.create_text("hello😀")?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[t.key()])?;
            Ok((p.key(), t.key()))
        })
        .unwrap();
    let diff = commit.diff(&DiffOptions::default()).unwrap();
    assert_eq!(
        diff.ops,
        vec![
            DiffOp::CreateElement {
                key: paragraph,
                type_index: editor.registry().index_of::<Paragraph>().unwrap(),
                base: ElementProps {
                    format: ElementFormat::Unset,
                    indent: 0,
                    direction: None,
                    text_format: TextFormat::empty(),
                    style: Arc::from(""),
                    text_style: Arc::from("")
                },
                props: SerializedNode::new()
            },
            DiffOp::CreateText {
                key: text,
                type_index: editor.registry().index_of::<Text>().unwrap(),
                text: "hello😀".into(),
                base: TextProps {
                    format: TextFormat::empty(),
                    mode: TextMode::Normal,
                    detail: TextDetail::empty(),
                    style: Arc::from("")
                },
                props: SerializedNode::new()
            },
            DiffOp::Children {
                parent: NodeKey::ROOT,
                children: vec![paragraph]
            },
            DiffOp::Children {
                parent: paragraph,
                children: vec![text]
            },
        ]
    );
    let mut buffer = DiffBuffer::default();
    diff.encode(&mut buffer);
    let mut direct = DiffBuffer::default();
    commit
        .encode_diff(&DiffOptions::default(), &mut direct)
        .unwrap();
    assert_eq!(buffer, direct);
    assert_eq!(&buffer.words[..5], &[1, 0, 0, DIFF_NONE, 4]);
    assert_eq!(buffer.strings, "hello😀".as_bytes());
}
#[test]
fn full_reconcile_undo_visits_changed_descendant_under_shared_ancestors() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (text, first) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let t = tx.create_text("before")?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[t.key()])?;
            Ok(t.key())
        })
        .unwrap();
    editor
        .update(|tx| {
            tx.text(text)?.set_text_content("after")?;
            Ok(())
        })
        .unwrap();
    let undo = editor
        .set_editor_state(first.next, TagSet::from_tags([UpdateTag::Historic]))
        .unwrap();
    let diff = undo.diff(&DiffOptions::default()).unwrap();
    assert!(diff.full_reconcile);
    assert_eq!(
        diff.ops,
        vec![DiffOp::Text {
            key: text,
            text: "before".into()
        }]
    );
}
#[test]
fn moved_nodes_emit_children_not_remove_create_and_removed_subtrees_are_ordered() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let ((p, q, a, b), _) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let q = tx.create(Paragraph::default())?;
            let a = tx.create_text("a")?;
            let b = tx.create_text("b")?;
            tx.text(a)?.set_detail(TextDetail::UNMERGEABLE)?;
            tx.text(b)?.set_detail(TextDetail::UNMERGEABLE)?;
            tx.append(NodeKey::ROOT, &[p.key(), q.key()])?;
            tx.append(p, &[a.key()])?;
            tx.append(q, &[b.key()])?;
            Ok((p.key(), q.key(), a.key(), b.key()))
        })
        .unwrap();
    let (_, moved) = editor.update(|tx| tx.append(q, &[a])).unwrap();
    assert!(
        moved
            .diff(&DiffOptions::default())
            .unwrap()
            .ops
            .iter()
            .any(|op| matches!(op, DiffOp::Children { .. }))
    );
    let (_, removed) = editor.update(|tx| tx.remove(q, true)).unwrap();
    let diff = removed.diff(&DiffOptions::default()).unwrap();
    assert!(matches!(diff.ops.first(),Some(DiffOp::Remove {key,subtree_root:true}) if *key==q));
    assert!(
        diff.ops
            .iter()
            .any(|op| matches!(op,DiffOp::Remove {key,subtree_root:false} if *key==a||*key==b))
    );
    assert!(diff.ops.contains(&DiffOp::Children {
        parent: NodeKey::ROOT,
        children: vec![p]
    }));
}
#[test]
fn state_is_opt_in_and_property_groups_only_emit_when_changed() {
    static COUNT: StateKey<u32> = StateKey::new("count", |value| {
        value.and_then(serde_json::Value::as_u64).unwrap_or(0) as u32
    });
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (text, _) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let t = tx.create_text("a")?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[t.key()])?;
            Ok(t.key())
        })
        .unwrap();
    let (_, commit) = editor.update(|tx| tx.set_state(text, &COUNT, 3)).unwrap();
    assert!(commit.diff(&DiffOptions::default()).unwrap().ops.is_empty());
    assert_eq!(
        commit
            .diff(&DiffOptions {
                include_state: true
            })
            .unwrap()
            .ops,
        vec![DiffOp::State {
            key: text,
            state: Some(
                serde_json::json!({"$":{"count":3}})
                    .as_object()
                    .unwrap()
                    .clone()
            )
        }]
    );
    let (_, commit) = editor
        .update(|tx| {
            tx.text(text)?.set_format(TextFormat::BOLD)?;
            Ok(())
        })
        .unwrap();
    assert_eq!(
        commit.diff(&DiffOptions::default()).unwrap().ops,
        vec![DiffOp::TextProps {
            key: text,
            props: TextProps {
                format: TextFormat::BOLD,
                mode: TextMode::Normal,
                detail: TextDetail::empty(),
                style: Arc::from("")
            }
        }]
    );
}

#[test]
fn full_reconcile_property_order_is_key_sorted_and_noops_emit_nothing() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let ((a, b), initial) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let q = tx.create(Paragraph::default())?;
            let a = tx.create_text("a")?;
            let b = tx.create_text("b")?;
            tx.append(NodeKey::ROOT, &[p.key(), q.key()])?;
            tx.append(p, &[a.key()])?;
            tx.append(q, &[b.key()])?;
            Ok((a.key(), b.key()))
        })
        .unwrap();
    editor
        .update(|tx| {
            tx.text(b)?.set_text_content("bb")?;
            tx.text(a)?.set_text_content("aa")?;
            Ok(())
        })
        .unwrap();
    let restored = editor
        .set_editor_state(initial.next, TagSet::default())
        .unwrap();
    assert_eq!(
        restored.diff(&DiffOptions::default()).unwrap().ops,
        vec![
            DiffOp::Text {
                key: a,
                text: "a".into()
            },
            DiffOp::Text {
                key: b,
                text: "b".into()
            }
        ]
    );
    let (_, noop) = editor.update(|_| Ok(())).unwrap();
    assert!(noop.diff(&DiffOptions::default()).unwrap().ops.is_empty());
}

mod decorator;
