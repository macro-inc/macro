use super::*;
use doc_sync_core::*;

fn fixture() -> Result<EditorSession, BoundaryError> {
    let config = wire::SessionConfigMsg {
        doc: "capture-lease-fixture".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![71, 72, 73],
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
    let editor = EditorSession::create_compat_inner(
        generated::ABI_MAJOR,
        &bytes(&config)?,
        0.0,
        0.0,
        &bytes(&compat::CompatConfig {
            editor_id: 1,
            classes: vec![],
        })?,
    )?;
    Ok(editor)
}

#[test]
fn scoped_callbacks_leave_normalization_to_the_outer_flush() -> Result<(), BoundaryError> {
    let mut editor = fixture()?;
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
    editor.compat_current_version_inner()?;
    editor.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
    let (host, machine) = editor.compat_parts()?;
    let machine::Session::Editor(session) = &mut machine.session else {
        panic!("editor");
    };
    let pending = host.pending.take().expect("pending");
    let (pending, result) =
        session.with_compat_update(pending, |tx| -> Result<(), BoundaryError> {
            let paragraph = tx.create(Paragraph {})?;
            let first = tx.create_text("a")?;
            let second = tx.create_text("b")?;
            tx.append(paragraph, &[first.key(), second.key()])?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            scopes::with_pending_frame(host, || {
                let pending = execute(tx, &[], batch_execution::Normalization::Deferred, vec![])?;
                assert!(!pending.published && !pending.noop);
                assert!(tx.needs_flush());
                assert_eq!(tx.children_keys(paragraph)?.len(), 2);
                let normalized = execute(tx, &[], batch_execution::Normalization::Updater, vec![])?;
                assert!(matches!(
                    normalized.outcome,
                    compat::CompatBatchOutcome::CompatBatchSuccess {}
                ));
                assert!(!tx.needs_flush());
                assert_eq!(tx.children_keys(paragraph)?.len(), 1);
                assert_eq!(tx.text_content(paragraph), "ab");
                Ok(())
            })
        })?;
    host.pending = Some(pending);
    result
}
