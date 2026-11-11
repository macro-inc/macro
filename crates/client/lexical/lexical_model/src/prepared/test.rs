use super::*;
use std::num::NonZeroUsize;

static TRANSFORMS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
static EVENT: EventKey<&'static str> = EventKey::new("prepared-event");

fn count_transform(_: &mut Transaction<'_>, _: Id<Text>) -> Result<(), Error> {
    TRANSFORMS.fetch_add(1, Ordering::Relaxed);
    Ok(())
}
struct CountAfter(Arc<std::sync::atomic::AtomicUsize>);
impl Plugin for CountAfter {
    fn name(&self) -> &'static str {
        "prepared-after-count"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn after_commit(&self, _: &mut Transaction<'_>, _: &Commit) -> Result<(), Error> {
        self.0.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }
}

#[test]
fn preparation_is_unpublished_and_admission_does_not_replay_transforms()
-> Result<(), Box<dyn std::error::Error>> {
    let after = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .transform::<Text>(count_transform)
        .plugin(CountAfter(after.clone()))
        .build()?;
    let initial_after = after.load(Ordering::Relaxed);
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("main 😀")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(t)?;
    tx.add_tag(UpdateTag::Paste);
    tx.flush()?;
    let transformed = TRANSFORMS.load(Ordering::Relaxed);
    assert!(transformed > 0);
    let prepared = tx.prepare()?;
    let receipt = prepared.receipt();
    assert_eq!(prepared.next().root_text_content().as_ref(), "main 😀");
    assert_eq!(prepared.previous().root_text_content().as_ref(), "");
    assert!(prepared.tags().contains(&UpdateTag::Paste));
    assert!(prepared.selection_changed());
    assert!(receipt.main_publication().is_none());
    assert!(editor.state().is_empty_state());
    assert_eq!(after.load(Ordering::Relaxed), initial_after);
    assert_eq!(TRANSFORMS.load(Ordering::Relaxed), transformed);
    let mut tx = editor.transaction();
    tx.adopt_prepared_update(prepared)?;
    assert!(receipt.main_publication().is_none());
    assert!(matches!(
        tx.create_text("not allowed"),
        Err(Error::WriteAfterSetEditorState)
    ));
    let commit = tx.commit()?;
    assert_eq!(receipt.main_publication(), Some(commit.id));
    assert_eq!(editor.state().root_text_content().as_ref(), "main 😀");
    assert_eq!(after.load(Ordering::Relaxed), initial_after);
    let _commit = editor.run_after_commit(commit);
    assert_eq!(after.load(Ordering::Relaxed), initial_after + 1);
    assert_eq!(TRANSFORMS.load(Ordering::Relaxed), transformed);
    Ok(())
}

fn populate(tx: &mut Transaction<'_>) -> Result<(), Error> {
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("same 😀 output")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(t)?;
    tx.add_tag(UpdateTag::Paste);
    tx.emit(&EVENT, "literal");
    Ok(())
}

#[test]
fn prepared_main_diff_bytes_match_actual_ordinary_commit() -> Result<(), Box<dyn std::error::Error>>
{
    let mut ordinary = Editor::builder(EditorMode::Headless).build()?;
    let (_, commit) = ordinary.update(populate)?;
    let options = DiffOptions {
        include_state: true,
    };
    let mut expected = DiffBuffer::default();
    commit.encode_diff(&options, &mut expected)?;
    let mut staged = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = staged.transaction();
    populate(&mut tx)?;
    tx.flush()?;
    let prepared = tx.prepare()?;
    assert_eq!(prepared.previous().to_json()?, commit.prev.to_json()?);
    assert_eq!(prepared.next().to_json()?, commit.next.to_json()?);
    let mut actual = DiffBuffer::default();
    prepared.diff(&options)?.encode(&mut actual);
    assert_eq!(actual, expected);
    assert!(staged.state().is_empty_state());
    let mut tx = staged.transaction();
    tx.adopt_prepared_update(prepared)?;
    let adopted = tx.commit()?;
    let mut published = DiffBuffer::default();
    adopted.encode_diff(&options, &mut published)?;
    assert_eq!(published, expected);
    assert_eq!(adopted.tags, commit.tags);
    assert_eq!(
        adopted.events_of(&EVENT).collect::<Vec<_>>(),
        vec![&"literal"]
    );
    Ok(())
}

#[test]
fn incomplete_pipeline_returns_the_owned_continuation_and_drop_cancels()
-> Result<(), Box<dyn std::error::Error>> {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("recover")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(t)?;
    assert_eq!(
        tx.step_pipeline(
            FlushMode::Transforms,
            PipelineBudget {
                max_work: NonZeroUsize::MIN
            }
        )?,
        PipelineProgress::Pending
    );
    let Err(failure) = tx.prepare() else {
        panic!("incomplete pipeline was prepared")
    };
    assert!(matches!(
        failure.error(),
        Error::Invariant("pipeline must finish before preparation")
    ));
    let (_, pending) = failure.into_parts();
    assert!(editor.state().is_empty_state());
    let mut tx = editor.resume(pending)?;
    assert_eq!(tx.text_content(NodeKey::ROOT), "recover");
    while tx.step_pipeline(
        FlushMode::Transforms,
        PipelineBudget {
            max_work: NonZeroUsize::MIN,
        },
    )? != PipelineProgress::Complete
    {}
    let prepared = tx.prepare()?;
    let receipt = prepared.receipt();
    drop(prepared);
    assert!(editor.state().is_empty_state());
    assert!(receipt.main_publication().is_none());
    let mut tx = editor.transaction();
    let next = tx.create(Paragraph::default())?;
    assert!(next.key().index() > t.key().index());
    Ok(())
}

#[test]
fn wrong_editor_refusal_returns_the_exact_prepared_capsule()
-> Result<(), Box<dyn std::error::Error>> {
    let mut a = Editor::builder(EditorMode::Headless).build()?;
    let mut b = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = a.transaction();
    populate(&mut tx)?;
    tx.flush()?;
    let prepared = tx.prepare()?;
    let expected = prepared.next().to_json()?;
    let receipt = prepared.receipt();
    let mut tx = b.transaction();
    let Err(refused) = tx.adopt_prepared_update(prepared) else {
        panic!("wrong editor admitted")
    };
    assert!(matches!(refused.error(), Error::StaleSuspendedUpdate));
    let (_, prepared) = refused.into_parts();
    drop(tx);
    assert_eq!(prepared.next().to_json()?, expected);
    assert!(receipt.main_publication().is_none());
    assert!(a.state().is_empty_state());
    assert!(b.state().is_empty_state());
    let mut tx = a.transaction();
    tx.adopt_prepared_update(prepared)?;
    let commit = tx.commit()?;
    assert_eq!(receipt.main_publication(), Some(commit.id));
    Ok(())
}

#[test]
fn event_only_and_selection_only_publish_even_when_records_are_shared()
-> Result<(), Box<dyn std::error::Error>> {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = editor.transaction();
    tx.emit(&EVENT, "event-only");
    tx.flush()?;
    let prepared = tx.prepare()?;
    assert!(prepared.changes().is_empty());
    let receipt = prepared.receipt();
    let mut tx = editor.transaction();
    tx.adopt_prepared_update(prepared)?;
    let commit = tx.commit()?;
    assert_eq!(receipt.main_publication(), Some(commit.id));
    assert!(Arc::ptr_eq(
        commit.prev.nodes.get(&NodeKey::ROOT).expect("root"),
        commit.next.nodes.get(&NodeKey::ROOT).expect("root")
    ));
    editor.update(populate)?;
    let mut tx = editor.transaction();
    tx.set_selection(None)?;
    tx.flush()?;
    let prepared = tx.prepare()?;
    assert!(prepared.changes().is_empty());
    assert!(prepared.selection_changed());
    let receipt = prepared.receipt();
    let mut tx = editor.transaction();
    tx.adopt_prepared_update(prepared)?;
    let commit = tx.commit()?;
    assert_eq!(receipt.main_publication(), Some(commit.id));
    assert!(commit.next.selection().is_none());
    Ok(())
}

#[test]
fn normalized_public_id_does_not_replace_the_actual_publication_watermark()
-> Result<(), Box<dyn std::error::Error>> {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = editor.transaction();
    populate(&mut tx)?;
    tx.flush()?;
    let prepared = tx.prepare()?;
    let receipt = prepared.receipt();
    let mut tx = editor.transaction();
    tx.adopt_prepared_update(prepared)?;
    let commit = tx.commit_with_metadata(|commit| commit.id = CommitId(0))?;
    assert_eq!(commit.id, CommitId(0));
    assert_eq!(receipt.main_publication(), Some(editor.suspend_version));
    assert_ne!(editor.suspend_version, CommitId(0));
    Ok(())
}

#[cfg(feature = "foreign-nodes")]
#[test]
fn observer_sees_only_actual_publication_after_receipt_and_metadata_normalization()
-> Result<(), Box<dyn std::error::Error>> {
    struct Observer {
        receipt: std::sync::Mutex<Option<PreparedReceipt>>,
        calls: std::sync::Mutex<Vec<(CommitId, Option<CommitId>)>>,
    }
    impl ForeignPublicationObserver for Observer {
        fn published(&self, commit: &Commit) {
            let receipt = self.receipt.lock().expect("receipt lock");
            self.calls.lock().expect("calls lock").push((
                commit.id,
                receipt.as_ref().and_then(PreparedReceipt::main_publication),
            ));
        }
        fn rolled_back(&self, _: &EditorState, _: CommitId) {}
    }
    let observer = Arc::new(Observer {
        receipt: std::sync::Mutex::new(None),
        calls: std::sync::Mutex::new(vec![]),
    });
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_publication_observer(observer.clone())
        .build()?;
    observer.calls.lock().expect("calls lock").clear();
    let mut tx = editor.transaction();
    populate(&mut tx)?;
    tx.flush()?;
    let prepared = tx.prepare()?;
    let receipt = prepared.receipt();
    *observer.receipt.lock().expect("receipt lock") = Some(receipt.clone());
    assert!(observer.calls.lock().expect("calls lock").is_empty());
    let mut tx = editor.transaction();
    tx.adopt_prepared_update(prepared)?;
    assert!(observer.calls.lock().expect("calls lock").is_empty());
    let commit = tx.commit_with_metadata(|commit| commit.id = CommitId(0))?;
    assert_eq!(commit.id, CommitId(0));
    assert_eq!(
        *observer.calls.lock().expect("calls lock"),
        vec![(CommitId(0), Some(editor.suspend_version))]
    );
    assert_eq!(receipt.main_publication(), Some(editor.suspend_version));
    Ok(())
}
