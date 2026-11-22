use super::*;
use std::cell::RefCell;
thread_local! { static CALLS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) }; }
fn record<Node: NodeType>(_: &mut Transaction<'_>, node: Id<Node>) -> Result<(), Error> {
    CALLS.with(|calls| {
        calls
            .borrow_mut()
            .push(format!("{} {}", Node::TYPE, node.key()))
    });
    Ok(())
}
#[test]
fn one_unit_slices_preserve_transform_order_dirty_sets_and_publication() -> Result<(), Error> {
    let mut results = Vec::new();
    for sliced in [false, true] {
        CALLS.with(|calls| calls.borrow_mut().clear());
        let mut editor = Editor::builder(EditorMode::Headless)
            .transform::<Text>(record::<Text>)
            .transform::<Paragraph>(record::<Paragraph>)
            .transform::<Root>(record::<Root>)
            .build()
            .expect("registry");
        let (_, commit) = editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let a = tx.create_text("first")?;
            tx.text(a)?.set_mode(TextMode::Token)?;
            let b = tx.create_text("second")?;
            tx.text(b)?.set_mode(TextMode::Token)?;
            tx.append(p, &[a.key(), b.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(b, Utf16Offset(6)),
            ))))?;
            if sliced {
                let mut steps = 0;
                while tx.step_pipeline(
                    FlushMode::Transforms,
                    PipelineBudget {
                        max_work: NonZeroUsize::MIN,
                    },
                )? == PipelineProgress::Pending
                {
                    assert_eq!(tx.committed_state().root_text_content().as_ref(), "");
                    steps += 1;
                    assert!(steps < 200);
                }
                assert!(steps > 10);
                assert!(tx.pipeline_continuation.is_none());
            } else {
                tx.flush()?;
                assert!(tx.pipeline_continuation.is_none());
            }
            Ok(())
        })?;
        results.push((
            CALLS.with(|calls| calls.borrow().clone()),
            commit.changes.dirty_leaves,
            commit.changes.dirty_elements,
            commit.changes.mutations,
            commit.next.selection().cloned(),
            commit.next.root_text_content().to_string(),
        ));
    }
    assert_eq!(results[0], results[1]);
    assert_eq!(results[0].0.last().map(String::as_str), Some("root root"));
    assert_eq!(results[0].5, "firstsecond");
    Ok(())
}
#[test]
fn normalize_only_slices_merge_text_and_collect_detached_subtrees() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let a = tx.create_text("a")?;
    let b = tx.create_text("b")?;
    tx.append(p, &[a.key(), b.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let detached = tx.create(Paragraph::default())?;
    let child = tx.create_text("discarded")?;
    tx.append(detached, &[child.key()])?;
    let budget = PipelineBudget {
        max_work: NonZeroUsize::MIN,
    };
    let mut steps = 0;
    while tx.step_pipeline(FlushMode::NormalizeOnly, budget)? == PipelineProgress::Pending {
        steps += 1;
        assert!(steps < 200);
    }
    assert!(!tx.pending.nodes.contains_key(&detached.key()));
    assert!(!tx.pending.nodes.contains_key(&child.key()));
    assert_eq!(tx.text_content(NodeKey::ROOT), "ab");
    assert_eq!(tx.normalized.len(), 2);
    let commit = tx.commit()?;
    assert_eq!(commit.next.root_text_content().as_ref(), "ab");
    Ok(())
}
fn oscillate(tx: &mut Transaction<'_>, node: Id<Text>) -> Result<(), Error> {
    let value = if tx.text_content(node) == "a" {
        "b"
    } else {
        "a"
    };
    tx.text(node)?.set_text_content(value)?;
    Ok(())
}
#[test]
fn failed_sliced_transform_cannot_replay_and_never_publishes() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .transform::<Text>(oscillate)
        .build()
        .expect("registry");
    let before = editor.state().clone();
    {
        let mut tx = editor.transaction();
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("a")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        let budget = PipelineBudget {
            max_work: NonZeroUsize::MIN,
        };
        let mut result = tx.step_pipeline(FlushMode::Transforms, budget);
        let mut steps = 0;
        while matches!(result, Ok(PipelineProgress::Pending)) {
            steps += 1;
            assert!(steps < 2000);
            result = tx.step_pipeline(FlushMode::Transforms, budget);
        }
        assert!(matches!(result, Err(Error::InfiniteTransforms)));
        assert!(matches!(
            tx.step_pipeline(FlushMode::Transforms, budget),
            Err(Error::Invariant("cannot resume a failed pipeline"))
        ));
        assert!(matches!(
            tx.flush(),
            Err(Error::Invariant("cannot resume a failed pipeline"))
        ));
        assert!(matches!(
            tx.create_text("rejected"),
            Err(Error::Invariant("pipeline work is suspended"))
        ));
        assert!(matches!(
            tx.flush(),
            Err(Error::Invariant("cannot resume a failed pipeline"))
        ));
    }
    assert!(editor.state().same_snapshot(&before));
    Ok(())
}

#[test]
fn suspended_work_rejects_writes_and_mode_changes_then_flush_resumes() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("kept")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    assert_eq!(
        tx.step_pipeline(
            FlushMode::Transforms,
            PipelineBudget {
                max_work: NonZeroUsize::MIN
            }
        )?,
        PipelineProgress::Pending
    );
    assert!(matches!(
        tx.create_text("rejected"),
        Err(Error::Invariant("pipeline work is suspended"))
    ));
    assert!(matches!(
        tx.step_pipeline(
            FlushMode::NormalizeOnly,
            PipelineBudget {
                max_work: NonZeroUsize::MIN
            }
        ),
        Err(Error::Invariant("cannot change a suspended pipeline mode"))
    ));
    assert!(matches!(
        tx.flush_with(FlushMode::NormalizeOnly),
        Err(Error::Invariant("cannot change a suspended pipeline mode"))
    ));
    assert!(tx.pipeline_continuation.is_some());
    tx.flush()?;
    assert!(tx.pipeline_continuation.is_none());
    assert_eq!(tx.commit()?.next.root_text_content().as_ref(), "kept");
    Ok(())
}

#[test]
fn sliced_pipeline_moves_through_suspend_resume_and_cancel_discards_it() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("registry");
    let before = editor.state().clone();
    let pending = {
        let mut tx = editor.transaction();
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("cancelled")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        assert_eq!(
            tx.step_pipeline(
                FlushMode::Transforms,
                PipelineBudget {
                    max_work: NonZeroUsize::MIN
                }
            )?,
            PipelineProgress::Pending
        );
        tx.suspend()
    };
    assert!(editor.state().same_snapshot(&before));
    let mut tx = editor.resume(pending)?;
    assert!(tx.pipeline_continuation.is_some());
    assert_eq!(
        tx.step_pipeline(
            FlushMode::Transforms,
            PipelineBudget {
                max_work: NonZeroUsize::MIN
            }
        )?,
        PipelineProgress::Pending
    );
    drop(tx.suspend());
    assert!(editor.state().same_snapshot(&before));
    let (_, commit) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("after")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])
    })?;
    assert_eq!(commit.next.root_text_content().as_ref(), "after");
    Ok(())
}

#[test]
fn new_sliced_pass_after_flush_must_finish_before_commit() -> Result<(), Error> {
    CALLS.with(|calls| calls.borrow_mut().clear());
    let mut editor = Editor::builder(EditorMode::Headless)
        .transform::<Root>(record::<Root>)
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.flush()?;
    assert!(!tx.dirty_since_flush);
    assert_eq!(
        tx.step_pipeline(
            FlushMode::Transforms,
            PipelineBudget {
                max_work: NonZeroUsize::MIN
            }
        )?,
        PipelineProgress::Pending
    );
    assert!(tx.dirty_since_flush);
    tx.commit()?;
    CALLS.with(|calls| assert_eq!(*calls.borrow(), vec!["root root", "root root"]));
    Ok(())
}

/// A committed host block followed by a valid MAX_NODE_DEPTH-deep chain under the root.
fn host_and_chain() -> Editor {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("registry");
    editor
        .update(|tx| {
            let host = tx.create(Paragraph::default())?;
            let chain = tx.create(Paragraph::default())?;
            tx.append(NodeKey::ROOT, &[host.key(), chain.key()])?;
            let mut parent = chain.key();
            for _ in 1..crate::json::MAX_NODE_DEPTH {
                let child = tx.create(Paragraph::default())?;
                tx.append(parent, &[child.key()])?;
                parent = child.key();
            }
            Ok(())
        })
        .expect("a 512-deep chain fits");
    editor
}
fn move_chain_under_host(tx: &mut Transaction<'_>) -> Result<(), Error> {
    let host = tx.first_child_or_err(NodeKey::ROOT)?;
    let chain = tx
        .last_child(NodeKey::ROOT)
        .ok_or(Error::NoChild(NodeKey::ROOT))?;
    tx.append(host, &[chain])
}
fn is_too_deep(error: &Error) -> bool {
    matches!(error, Error::NestingTooDeep { limit } if *limit == crate::json::MAX_NODE_DEPTH)
}
// The depth check runs after queued updates mutate, not only before the pipeline starts.
#[test]
fn a_queued_update_that_moves_a_chain_past_the_cap_is_refused() {
    std::thread::Builder::new()
        .stack_size(16 << 20)
        .spawn(|| {
            let mut editor = host_and_chain();
            let error = editor
                .update(|tx| tx.queue_update(move_chain_under_host, UpdateOptions::default()))
                .expect_err("the queued move pushes the leaf to 513");
            assert!(is_too_deep(&error), "{error}");
        })
        .expect("spawn")
        .join()
        .expect("no stack overflow");
}
// Cooperative stepping runs the same check as a flush.
#[test]
fn stepping_the_pipeline_over_a_tree_past_the_cap_is_refused() {
    std::thread::Builder::new()
        .stack_size(16 << 20)
        .spawn(|| {
            let mut editor = host_and_chain();
            let error = editor
                .update(|tx| {
                    move_chain_under_host(tx)?;
                    while tx.step_pipeline(
                        FlushMode::Transforms,
                        PipelineBudget {
                            max_work: NonZeroUsize::MIN,
                        },
                    )? == PipelineProgress::Pending
                    {}
                    Ok(())
                })
                .expect_err("stepping refuses the 513-deep leaf");
            assert!(is_too_deep(&error), "{error}");
        })
        .expect("spawn")
        .join()
        .expect("no stack overflow");
}
