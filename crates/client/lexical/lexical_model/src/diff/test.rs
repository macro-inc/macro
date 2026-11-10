use super::*;

// Frozen sibling-walk oracle for the ordering contract. Every model unit-test
// sort also checks this independently of the per-diff position memo.
pub(super) fn legacy_preorder_sort(
    view: StateRef<'_>,
    keys: impl IntoIterator<Item = NodeKey>,
) -> Vec<NodeKey> {
    let mut nodes = keys
        .into_iter()
        .map(|key| {
            let mut path = vec![];
            let mut current = key;
            while let Some(parent) = view.parent(current) {
                path.push(
                    view.index_within_parent(current)
                        .map_or(u32::MAX, |index| index.0),
                );
                current = parent;
            }
            path.reverse();
            (path, key)
        })
        .collect::<Vec<_>>();
    nodes.sort_by(|(a, ka), (b, kb)| a.cmp(b).then(ka.cmp(kb)));
    nodes.into_iter().map(|(_, key)| key).collect()
}

#[test]
fn wide_siblings_share_one_sweep_across_created_and_parent_ordering() {
    for count in [128, 4096] {
        let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
        let (keys, commit) = editor
            .update(|tx| {
                let mut keys = Vec::new();
                let mut paragraphs = Vec::new();
                for _ in 0..count {
                    let paragraph = tx.create(Paragraph::default())?;
                    let text = tx.create_text("text😀")?;
                    tx.append(paragraph, &[text.key()])?;
                    paragraphs.push(paragraph.key());
                    keys.extend([paragraph.key(), text.key()]);
                }
                tx.append(NodeKey::ROOT, &paragraphs)?;
                Ok(keys)
            })
            .unwrap();
        let view = commit.next.view();
        let mut positions = ChildPositions::default();
        assert_eq!(
            preorder_sort(view, keys.iter().rev().copied(), &mut positions),
            keys
        );
        assert_eq!(positions.scanned_children, count);
        assert_eq!(positions.parents.len(), 1);
        assert_eq!(positions.indices.len(), count);

        let parents: Vec<_> = std::iter::once(NodeKey::ROOT)
            .chain(keys.iter().step_by(2).copied())
            .collect();
        assert_eq!(
            preorder_sort(view, parents.iter().rev().copied(), &mut positions),
            parents
        );
        assert_eq!(positions.scanned_children, count);
    }
}

#[test]
fn empty_single_and_boundary_sorts_leave_rank_tables_unallocated() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (keys, commit) = editor
        .update(|tx| {
            let mut keys = Vec::new();
            for _ in 0..3 {
                keys.push(tx.create(Paragraph::default())?.key());
            }
            tx.append(NodeKey::ROOT, &keys)?;
            Ok(keys)
        })
        .unwrap();
    let view = commit.next.view();
    let mut positions = ChildPositions::default();
    assert!(preorder_sort(view, [], &mut positions).is_empty());
    assert_eq!(preorder_sort(view, [keys[1]], &mut positions), [keys[1]]);
    assert_eq!(
        preorder_sort(view, [keys[2], keys[0], NodeKey::ROOT], &mut positions),
        [NodeKey::ROOT, keys[0], keys[2]]
    );
    assert_eq!(positions.scanned_children, 0);
    assert_eq!(positions.parents.capacity(), 0);
    assert_eq!(positions.indices.capacity(), 0);
}

#[test]
fn detached_path_ties_duplicates_and_missing_parent_match_sibling_walk() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (paragraph, commit) = editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            Ok(paragraph.key())
        })
        .unwrap();
    let detached = NodeKey::from_parts(KeyParts {
        generation: 7,
        index: 9000,
    });
    let view = commit.next.view();
    let keys = [paragraph, detached, NodeKey::ROOT, detached];
    let mut positions = ChildPositions::default();
    assert_eq!(
        preorder_sort(view, keys, &mut positions),
        legacy_preorder_sort(view, keys)
    );
    assert_eq!(positions.index(view, detached, paragraph), u32::MAX);
    assert_eq!(positions.scanned_children, 0);
}

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
