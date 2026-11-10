use super::*;
use lexical_model::*;
use loro::ExportMode;
static PLAIN: PlainPolicy = PlainPolicy;

/// Compare the actual indexed writer against the unchanged general reconciler,
/// including exact operation order, not just a reconstructed document.
fn project_pair(
    editor: &Editor,
    commit: Commit,
    docs: &[LoroDoc; 2],
    projections: &mut [LoroProjection; 2],
    now: i64,
) -> Result<ProjectionStats> {
    let before = docs[0].oplog_vv();
    projections[1].child_index = super::ChildIndex::default();
    let indexed =
        projections[0].local_commit(&docs[0], std::slice::from_ref(&commit), LOCAL_ORIGIN, now)?;
    projections[1].local_commit(&docs[1], &[commit], LOCAL_ORIGIN, now)?;
    assert_eq!(docs[0].get_deep_value(), docs[1].get_deep_value());
    assert_eq!(docs[0].oplog_vv(), docs[1].oplog_vv());
    assert_eq!(docs[0].oplog_frontiers(), docs[1].oplog_frontiers());
    assert_eq!(
        serde_json::to_string(&docs[0].export_json_updates(&before, &docs[0].oplog_vv())?)
            .expect("ordered JSON operations"),
        serde_json::to_string(&docs[1].export_json_updates(&before, &docs[1].oplog_vv())?)
            .expect("ordered JSON operations"),
    );
    for (projection, doc) in projections.iter().zip(docs) {
        projection
            .check(doc, editor.state())
            .expect("independent full tree check");
    }
    Ok(indexed.stats)
}

#[test]
fn repeated_separated_insertions_then_move_and_delete_keep_exact_operations() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let (original, _) = editor.update(|tx| {
        let mut keys = Vec::new();
        for _ in 0..40 {
            keys.push(tx.create(Paragraph::default())?.key());
        }
        tx.append(NodeKey::ROOT, &keys)?;
        Ok(keys)
    })?;
    let doc = new_doc(7)?;
    let first = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    let second_doc = fork_doc(&doc, 7)?;
    let second = LoroProjection::attach(&second_doc, editor.state(), &PLAIN)?;
    let docs = [doc, second_doc];
    let mut projections = [first, second];
    for round in 1..=4 {
        let (_, commit) = editor.update(|tx| {
            for position in [0, 9, 27, 39] {
                let a = tx.create(Paragraph::default())?;
                let b = tx.create(Paragraph::default())?;
                tx.insert_before(original[position], a.key(), true)?;
                tx.insert_before(original[position], b.key(), true)?;
            }
            Ok(())
        })?;
        assert_eq!(
            project_pair(&editor, commit, &docs, &mut projections, round)?.children_scanned,
            8
        );
    }
    let (_, commit) = editor.update(|tx| {
        tx.insert_before(original[0], original[39], true)?;
        tx.remove(original[27], true)?;
        Ok(())
    })?;
    assert!(project_pair(&editor, commit, &docs, &mut projections, 5)?.children_scanned > 40);
    // The fallback rebuilt the current parent index, so the next fresh insert
    // uses anchors whose positions reflect the actual move/delete.
    let (_, commit) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        tx.insert_before(original[9], p.key(), true)?;
        Ok(())
    })?;
    assert_eq!(
        project_pair(&editor, commit, &docs, &mut projections, 6)?.children_scanned,
        1
    );
    Ok(())
}

#[test]
fn pending_native_write_and_checkout_invalidate_anchors_without_losing_fields() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let (_, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[p.key()])
    })?;
    let doc = new_doc(7)?;
    let first = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    let second_doc = fork_doc(&doc, 7)?;
    let second = LoroProjection::attach(&second_doc, editor.state(), &PLAIN)?;
    let docs = [doc, second_doc];
    let mut projections = [first, second];
    // The extra field is local-only under this policy, but its pending native
    // transaction must still prevent trusting cached structural anchors.
    for doc in &docs {
        doc.get_map("unrelated").insert("pending", 1)?;
    }
    let (_, commit) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[p.key()])
    })?;
    assert!(project_pair(&editor, commit, &docs, &mut projections, 1)?.children_scanned > 1);
    let frontiers = docs[0].state_frontiers();
    for doc in &docs {
        doc.get_map("unrelated").insert("committed", 2)?;
        doc.commit();
        doc.checkout(&frontiers)?;
        doc.attach();
    }
    let (_, commit) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[p.key()])
    })?;
    assert!(project_pair(&editor, commit, &docs, &mut projections, 2)?.children_scanned > 1);
    let fresh = new_doc(9)?;
    fresh.import(&docs[0].export(ExportMode::Snapshot)?)?;
    assert_eq!(fresh.get_deep_value(), docs[0].get_deep_value());
    Ok(())
}

#[test]
fn partial_subtree_failure_discards_anchors_and_retry_stays_fail_closed() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .opaque_unknown_types(true)
        .build()
        .expect("editor");
    let (_, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[p.key()])
    })?;
    let doc = new_doc(7)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    let (_, commit) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let malformed = tx.import_node(
            serde_json::json!({
                "type":"future-element", "version":1, "children":[], "text":123
            })
            .as_object()
            .expect("literal future node"),
        )?;
        tx.append(NodeKey::ROOT, &[p.key(), malformed])
    })?;
    let generic_doc = fork_doc(&doc, 7)?;
    let mut generic = LoroProjection::attach(&generic_doc, &commit.prev, &PLAIN)?;
    generic.child_index = super::ChildIndex::default();
    assert!(matches!(
        projection.local_commit(&doc, std::slice::from_ref(&commit), LOCAL_ORIGIN, 1),
        Err(ProjectionError::Schema { .. })
    ));
    assert!(
        doc.inner().get_pending_txn_len() > 0,
        "actual partial native write"
    );
    assert!(projection.child_index.counts.is_empty());
    assert!(projection.child_index.anchors.is_empty());
    assert!(matches!(
        generic.local_commit(&generic_doc, std::slice::from_ref(&commit), LOCAL_ORIGIN, 1),
        Err(ProjectionError::Schema { .. })
    ));
    // Native subtree initialization is fallible, not an atomic document update.
    // Preserve the same authored debt as the general writer; failure must never
    // certify the anchors or silently discard that debt on retry.
    assert_eq!(doc.get_deep_value(), generic_doc.get_deep_value());
    assert_eq!(doc.oplog_vv(), generic_doc.oplog_vv());
    let partial = doc.get_deep_value();
    assert!(
        projection
            .local_commit(&doc, std::slice::from_ref(&commit), LOCAL_ORIGIN, 1)
            .is_err()
    );
    assert!(
        generic
            .local_commit(&generic_doc, &[commit], LOCAL_ORIGIN, 1)
            .is_err()
    );
    assert_eq!(partial, doc.get_deep_value());
    assert_eq!(doc.get_deep_value(), generic_doc.get_deep_value());
    assert!(projection.child_index.counts.is_empty());
    assert!(projection.check(&doc, editor.state()).is_err());
    Ok(())
}
