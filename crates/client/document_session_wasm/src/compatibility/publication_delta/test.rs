use super::*;
use doc_sync_core::*;

#[test]
fn real_publications_ship_bounded_edits_and_every_removed_descendant() -> Result<(), BoundaryError>
{
    let config = wire::SessionConfigMsg {
        doc: "compat-sparse-publication".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![31, 32, 33],
        access: wire::Access::Edit,
        transport: wire::Transport::None,
        durable: false,
        chatter: false,
        headless: false,
        view_engine: 1,
        view_os: 0,
        token: String::new(),
        traceparent: String::new(),
        coalesce: 25,
        snapshot_interval: 0,
        observed: vec![],
    };
    let mut editor = EditorSession::create_compat_inner(
        generated::ABI_MAJOR,
        &bytes(&config)?,
        0.0,
        0.0,
        &bytes(&compat::CompatConfig {
            editor_id: 1,
            classes: vec![],
        })?,
    )?;
    editor.machine.sync(SyncInput::Start, 0.0, None)?;
    editor.machine.sync(
        SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        },
        1.0,
        None,
    )?;
    while !compat::CompatPublications::deserialize(&editor.compat_take_publications_inner()?)?
        .commits
        .is_empty()
    {}
    editor.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
    let (host, machine) = editor.compat_parts()?;
    let machine::Session::Editor(session) = &mut machine.session else {
        panic!("editor")
    };
    let pending = host.pending.take().expect("pending");
    let (pending, nodes) = session.with_compat_update(pending, |tx| -> Result<_, Error> {
        for key in tx.children_keys(NodeKey::ROOT)? {
            tx.remove(key, false)?;
        }
        let mut nodes = vec![];
        for _ in 0..10 {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text("unchanged text")?;
            tx.append(p, &[text.key()])?;
            nodes.push((p.key(), text.key()));
        }
        tx.append(
            NodeKey::ROOT,
            &nodes.iter().map(|(key, _)| *key).collect::<Vec<_>>(),
        )?;
        Ok(nodes)
    })?;
    host.pending = Some(pending);
    let nodes = nodes?;
    let created = editor.compat_commit_inner(2.0, 2.0)?;
    assert!(!created.batch.full_reconcile);
    let initial = editor.compat_snapshot_inner(created.version)?;
    assert!(initial.batch.full_reconcile);
    assert_eq!(initial.batch.records.len(), 21);

    editor.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
    let (host, machine) = editor.compat_parts()?;
    let machine::Session::Editor(session) = &mut machine.session else {
        panic!("editor")
    };
    let pending = host.pending.take().expect("pending");
    let (pending, result) = session.with_compat_update(pending, |tx| {
        tx.text(nodes[0].1)?
            .set_text_content("small edit")
            .map(|_| ())
    })?;
    host.pending = Some(pending);
    result?;
    let small = editor.compat_commit_inner(3.0, 3.0)?;
    assert!(!small.batch.full_reconcile);
    assert_eq!(small.batch.records.len(), 3);
    assert!(small.batch.removed_keys.is_empty());
    let small_bytes = bytes(&small)?.len();
    assert!(small_bytes <= 4096);

    editor.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
    let (host, machine) = editor.compat_parts()?;
    let machine::Session::Editor(session) = &mut machine.session else {
        panic!("editor")
    };
    let pending = host.pending.take().expect("pending");
    let (pending, result) = session.with_compat_update(pending, |tx| -> Result<(), Error> {
        let mut paragraphs = vec![];
        for _ in 10..10_000 {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text("unchanged text")?;
            tx.append(p, &[text.key()])?;
            paragraphs.push(p.key());
        }
        tx.append(NodeKey::ROOT, &paragraphs)?;
        Ok(())
    })?;
    host.pending = Some(pending);
    result?;
    let grown = editor.compat_commit_inner(4.0, 4.0)?;
    assert!(!grown.batch.full_reconcile);
    // The old last paragraph also changes its next-sibling link.
    assert_eq!(grown.batch.records.len(), 19_982);
    assert!(grown
        .batch
        .records
        .iter()
        .any(|record| record.record.node.key == records::key(nodes[9].0)));
    assert!(grown
        .batch
        .records
        .iter()
        .all(|record| !record.has_root_cached_text && record.root_cached_text.is_empty()));

    editor.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
    let (host, machine) = editor.compat_parts()?;
    let machine::Session::Editor(session) = &mut machine.session else {
        panic!("editor")
    };
    let pending = host.pending.take().expect("pending");
    let (pending, result) = session.with_compat_update(pending, |tx| {
        tx.text(nodes[0].1)?
            .set_text_content("large edit")
            .map(|_| ())
    })?;
    host.pending = Some(pending);
    result?;
    let large = editor.compat_commit_inner(5.0, 5.0)?;
    assert!(!large.batch.full_reconcile);
    assert_eq!(large.batch.records.len(), 3);
    assert!(large.batch.removed_keys.is_empty());
    assert_eq!(bytes(&large)?.len(), small_bytes);

    editor.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
    let (host, machine) = editor.compat_parts()?;
    let machine::Session::Editor(session) = &mut machine.session else {
        panic!("editor")
    };
    let pending = host.pending.take().expect("pending");
    let (pending, result) =
        session.with_compat_update(pending, |tx| tx.remove(nodes[0].0, false))?;
    host.pending = Some(pending);
    result?;
    let removed = editor.compat_commit_inner(6.0, 6.0)?;
    assert!(!removed.batch.full_reconcile);
    assert!(removed
        .batch
        .removed_keys
        .contains(&records::key(nodes[0].0)));
    assert!(removed
        .batch
        .removed_keys
        .contains(&records::key(nodes[0].1)));
    assert_eq!(removed.batch.removed_keys.len(), 2);
    assert!(removed
        .batch
        .records
        .iter()
        .all(|record| !removed.batch.removed_keys.contains(&record.record.node.key)));
    let final_snapshot = editor.compat_snapshot_inner(removed.version)?;
    assert_eq!(final_snapshot.batch.records.len(), 19_999);
    Ok(())
}
