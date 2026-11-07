use super::hooks::{AssignIds, Ids};
use super::*;
pub(super) fn apply_remote(
    projection: &mut LoroProjection,
    doc: &LoroDoc,
    core: &mut EditorCore,
    changes: RemoteChanges,
    now: u64,
) -> Result<LocalProjected> {
    let output = core
        .apply(
            Input::ApplyRemote {
                changes: changes.changes.clone(),
                options: UpdateOptions {
                    skip_transforms: false,
                    tags: TagSet::from_tags([
                        UpdateTag::Collaboration,
                        UpdateTag::Custom("from-loro".into()),
                    ]),
                },
            },
            HistoryTime(now),
        )
        .expect("remote input");
    let created = output
        .effects
        .iter()
        .flat_map(|effect| match effect {
            Effect::RemoteNodesCreated(pairs) => pairs.clone(),
            _ => Vec::new(),
        })
        .collect::<Vec<_>>();
    projection.bind_created(changes, &created)?;
    projection.local_commit(doc, &output.commits, FIXUP_ORIGIN, now as i64)
}
#[test]
fn cross_parent_remote_move_reuses_the_id_key_and_preserves_selection() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .build()
        .expect("editor");
    let ((left, right, text), _) = editor.update(|tx| {
        let left = tx.create(Paragraph::default())?;
        let right = tx.create(Paragraph::default())?;
        let text = tx.create_text("moving😀")?;
        tx.set_state(left, &ID, "left".into())?;
        tx.set_state(right, &ID, "right".into())?;
        tx.set_state(text, &ID, "text".into())?;
        tx.append(left, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[left.key(), right.key()])?;
        tx.text(text)?
            .select(Some(Utf16Offset(3)), Some(Utf16Offset(3)))?;
        Ok((left, right, text))
    })?;
    let doc = new_doc(1)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    let cursors = projection
        .cursor(
            &doc,
            editor.state(),
            editor.state().selection().expect("selection"),
        )
        .expect("cursors");
    let old = projection
        .container_of(text.key())
        .cloned()
        .expect("container");
    let peer = fork_doc(&doc, 2)?;
    let before = peer.oplog_vv();
    let parent = projection.index.map(&peer, left.key())?;
    let list = schema::children(&parent)?.expect("children");
    let value = schema::read_node(&schema::map_at(list.get(0), "text")?, &PLAIN)?;
    list.delete(0, 1)?;
    let destination = projection.index.map(&peer, right.key())?;
    let list = schema::children(&destination)?.expect("children");
    let replacement = list.insert_container(0, LoroMap::new())?;
    schema::initialize_map(&replacement, &value, schema::MapSchema::Node)?;
    peer.commit_with(loro::CommitOptions::new().timestamp(1));
    let (_, changes) = projection.remote(
        &doc,
        editor.state(),
        &peer.export(ExportMode::updates(&before))?,
    )?;
    assert!(
        !changes
            .changes
            .iter()
            .any(|c| matches!(c, NodeChange::Create { .. }))
    );
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    assert!(!apply_remote(&mut projection, &doc, &mut core, changes, 1)?.changed);
    assert_eq!(core.state().view().parent(text), Some(right.key()));
    assert_ne!(projection.container_of(text.key()), Some(&old));
    // Session restoration follows raw model fixups, as S11 §4.4 specifies.
    let anchor = projection
        .point(&doc, core.state(), &cursors.anchor)
        .expect("resolved anchor");
    let focus = projection
        .point(&doc, core.state(), &cursors.focus)
        .expect("resolved focus");
    core.apply(
        Input::SelectionFromView {
            selection: ViewSelection::Range {
                anchor,
                focus,
                resolution_dirty: false,
            },
            change: None,
        },
        HistoryTime(2),
    )
    .expect("restore cursor");
    assert_eq!(
        core.state()
            .selection()
            .and_then(Selection::as_range)
            .expect("selection")
            .anchor,
        Point::text(text, Utf16Offset(3))
    );
    projection.check(&doc, core.state()).expect("consistent");
    Ok(())
}

#[test]
fn concurrent_two_peer_edits_and_permuted_delivery_converge_without_echo() -> Result<()> {
    let mut a = Editor::builder(EditorMode::Headless)
        .extension_state(Ids { peer: "a", next: 0 })
        .plugin(AssignIds)
        .build()
        .expect("editor");
    let ((ta, tb), _) = a.update(|tx| {
        let pa = tx.create(Paragraph::default())?;
        let pb = tx.create(Paragraph::default())?;
        let ta = tx.create_text("A:")?;
        let tb = tx.create_text("B:")?;
        tx.append(pa, &[ta.key()])?;
        tx.append(pb, &[tb.key()])?;
        tx.append(NodeKey::ROOT, &[pa.key(), pb.key()])?;
        Ok((ta, tb))
    })?;
    let doc_a = new_doc(1)?;
    let mut projection_a = LoroProjection::initialize(&doc_a, a.state(), &PLAIN, 0)?;
    let mut b = Editor::builder(EditorMode::Headless)
        .extension_state(Ids { peer: "b", next: 0 })
        .plugin(AssignIds)
        .build()
        .expect("editor");
    let imported = b.parse_editor_state(&a.state().to_json()?)?;
    b.set_editor_state(imported, TagSet::default())?;
    let btext = b
        .state()
        .view()
        .last_descendant(NodeKey::ROOT)
        .expect("text");
    let doc_b = fork_doc(&doc_a, 2)?;
    let mut projection_b = LoroProjection::attach(&doc_b, b.state(), &PLAIN)?;
    let baseline_a = doc_a.oplog_vv();
    let baseline_b = doc_b.oplog_vv();
    let (_, ca) = a.update(|tx| {
        tx.select_end(ta)?;
        tx.insert_text("alpha😀")
    })?;
    projection_a.local_commit(&doc_a, &[ca], LOCAL_ORIGIN, 1)?;
    let (_, cb) = b.update(|tx| {
        tx.select_end(btext)?;
        tx.insert_text("betaé")
    })?;
    projection_b.local_commit(&doc_b, &[cb], LOCAL_ORIGIN, 2)?;
    let ua = doc_a.export(ExportMode::updates(&baseline_a))?;
    let ub = doc_b.export(ExportMode::updates(&baseline_b))?;
    let mut core_a = EditorCore::new(
        a,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let mut core_b = EditorCore::new(
        b,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let (_, changes) = projection_a.remote(&doc_a, core_a.state(), &ub)?;
    assert!(!apply_remote(&mut projection_a, &doc_a, &mut core_a, changes, 3)?.changed);
    let (_, changes) = projection_b.remote(&doc_b, core_b.state(), &ua)?;
    assert!(!apply_remote(&mut projection_b, &doc_b, &mut core_b, changes, 3)?.changed);
    assert_eq!(doc_a.get_deep_value(), doc_b.get_deep_value());
    assert_eq!(
        synced_json(core_a.state(), &PLAIN)?,
        synced_json(core_b.state(), &PLAIN)?
    );
    assert_eq!(core_a.state().view().text_content(ta), "A:alpha😀");
    assert_eq!(core_a.state().view().text_content(tb), "B:betaé");
    projection_a.check(&doc_a, core_a.state()).expect("peer A");
    projection_b.check(&doc_b, core_b.state()).expect("peer B");
    // Duplicate redelivery does not produce model writes.
    assert!(
        projection_a
            .remote(&doc_a, core_a.state(), &ub)?
            .1
            .changes
            .is_empty()
    );
    Ok(())
}

#[test]
fn deleting_children_slot_detaches_existing_editor_children_and_fixup_repairs_schema() -> Result<()>
{
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let (p, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("remove")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(p)
    })?;
    let doc = new_doc(1)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    let map = projection.index.map(&doc, p.key())?;
    map.delete("children")?;
    doc.commit_with(loro::CommitOptions::new().origin("other").timestamp(1));
    let changes = projection.take_remote(&doc, editor.state())?;
    assert!(changes.changes.iter().any(|c|matches!(c,NodeChange::Children{parent:NodeTarget::Key(key),children} if *key==p.key()&&children.is_empty())));
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    assert!(apply_remote(&mut projection, &doc, &mut core, changes, 1)?.changed);
    assert!(core.state().view().is_empty(p));
    projection.check(&doc, core.state()).expect("repaired");
    Ok(())
}
