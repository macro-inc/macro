//! Enter-shaped root insertions: the root's child-order work does not grow with unaffected siblings,
//! and every detached middle insertion matches the old general splice path on an identical seed.
use crate::test_work::{ChildWork, Measurement, Phase, force_general_splice};
use crate::*;

/// `blocks` root paragraphs, one text each, with the caret inside the first text.
fn seed(blocks: usize) -> Result<(Editor, Vec<NodeKey>), Error> {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .build()
        .expect("registry");
    let (paragraphs, _) = editor.update(|tx| {
        let mut paragraphs = Vec::with_capacity(blocks);
        let mut first_text = None;
        for index in 0..blocks {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text(&format!("block {index}"))?;
            tx.append(paragraph, &[text.key()])?;
            paragraphs.push(paragraph.key());
            first_text.get_or_insert(text.key());
        }
        tx.append(NodeKey::ROOT, &paragraphs)?;
        if let Some(text) = first_text {
            tx.text(text)?
                .select(Some(Utf16Offset(3)), Some(Utf16Offset(3)))?;
        }
        Ok(paragraphs)
    })?;
    Ok((editor, paragraphs))
}

/// One Enter-shaped edit of the root.
#[derive(Clone, Copy, Debug)]
enum Edit {
    /// `count` new paragraphs, each through the virtual `insert_after` of the previous one.
    InsertAfter { anchor: usize, count: usize },
    /// One `splice` call inserting `count` new paragraphs at root index `start`.
    Splice { start: u32, count: usize },
}

type ElementLinks = Option<(Option<NodeKey>, Option<NodeKey>, u32)>;

#[derive(Debug, PartialEq)]
struct Outcome {
    json: String,
    links: Vec<(NodeKey, Links, ElementLinks)>,
    /// Dirty marks at the end of the update closure, before the commit pipeline.
    pending_dirty_leaves: Vec<NodeKey>,
    pending_dirty_elements: Vec<(NodeKey, DirtyIntent)>,
    /// Dirty marks and mutations of the final commit.
    commit_dirty_leaves: Vec<NodeKey>,
    commit_dirty_elements: Vec<(NodeKey, DirtyIntent)>,
    commit_mutations: Vec<(NodeKey, Mutation)>,
    previous_selection: Option<Selection>,
    selection: Option<Selection>,
    ops: Vec<DiffOp>,
}

#[derive(Debug)]
struct Work {
    diff: ChildWork,
    splice: ChildWork,
    unscoped: ChildWork,
}

fn links(state: &EditorState) -> Vec<(NodeKey, Links, ElementLinks)> {
    let mut links = state
        .nodes
        .iter()
        .map(|(key, slot)| {
            let element = match &slot.base {
                BaseData::Element(element) => Some((element.first, element.last, element.size)),
                _ => None,
            };
            (*key, slot.links, element)
        })
        .collect::<Vec<_>>();
    links.sort_by_key(|(key, ..)| *key);
    links
}

fn apply(tx: &mut Transaction<'_>, paragraphs: &[NodeKey], edit: Edit) -> Result<(), Error> {
    match edit {
        Edit::InsertAfter { anchor, count } => {
            let mut after = paragraphs[anchor];
            for _ in 0..count {
                let paragraph = tx.create(Paragraph::default())?;
                after = tx.insert_after(after, paragraph.key(), true)?;
            }
        }
        Edit::Splice { start, count } => {
            let nodes = (0..count)
                .map(|_| {
                    tx.create(Paragraph::default())
                        .map(|paragraph| paragraph.key())
                })
                .collect::<Result<Vec<_>, _>>()?;
            tx.splice(NodeKey::ROOT, ChildIndex(start), 0, &nodes)?;
        }
    }
    Ok(())
}

/// Run `edit` on a fresh seed, optionally forcing the old general splice path for detached middle
/// insertions (the only path the new fast path replaces), and record the result and child work.
fn run(blocks: usize, edit: Edit, general: bool) -> Result<(Outcome, Work), Error> {
    let (mut editor, paragraphs) = seed(blocks)?;
    let measurement = Measurement::start();
    let force = general.then(force_general_splice);
    let ((pending_dirty_leaves, pending_dirty_elements), commit) = editor.update(|tx| {
        apply(tx, &paragraphs, edit)?;
        Ok((
            tx.dirty_leaves.iter().copied().collect::<Vec<_>>(),
            tx.dirty_elements
                .iter()
                .map(|(key, intent)| (*key, *intent))
                .collect::<Vec<_>>(),
        ))
    })?;
    drop(force);
    let ops = commit.diff(&DiffOptions::default())?.ops;
    let work = Work {
        diff: measurement.children(Some(Phase::Diff)),
        splice: measurement.children(Some(Phase::Splice)),
        unscoped: measurement.children(None),
    };
    let outcome = Outcome {
        json: commit.next.to_json_string()?,
        links: links(&commit.next),
        pending_dirty_leaves,
        pending_dirty_elements,
        commit_dirty_leaves: commit.changes.dirty_leaves.iter().copied().collect(),
        commit_dirty_elements: commit
            .changes
            .dirty_elements
            .iter()
            .map(|(key, intent)| (*key, *intent))
            .collect(),
        commit_mutations: commit
            .changes
            .mutations
            .iter()
            .map(|(key, mutation)| (*key, *mutation))
            .collect(),
        previous_selection: commit.prev.view().selection().cloned(),
        selection: commit.next.view().selection().cloned(),
        ops,
    };
    Ok((outcome, work))
}

#[test]
fn enter_after_the_first_block_diffs_the_root_order_independent_of_document_size()
-> Result<(), Error> {
    let mut residuals = Vec::new();
    for blocks in [50, 500, 5000] {
        let edit = Edit::InsertAfter {
            anchor: 0,
            count: 1,
        };
        let (outcome, work) = run(blocks, edit, false)?;
        let (general, _) = run(blocks, edit, true)?;
        assert_eq!(
            outcome, general,
            "new and old splice paths differ at {blocks}"
        );
        // The host contract sends the complete next root order once; the previous order is read
        // only up to its first difference. Splice counts are pinned separately below.
        assert_eq!(
            work.diff.root_keys,
            blocks + 1,
            "diff root keys at {blocks}"
        );
        assert_eq!(
            work.diff.root_steps, 2,
            "diff previous-order reads at {blocks}"
        );
        residuals.push((
            work.diff.other_keys,
            work.diff.other_steps,
            work.splice.other_keys,
            work.splice.other_steps,
            work.unscoped,
        ));
        eprintln!("CHILD_LIST_WORK blocks={blocks} {work:?}");
    }
    assert!(
        residuals.windows(2).all(|pair| pair[0] == pair[1]),
        "non-root and unscoped child work must not depend on document size: {residuals:?}"
    );
    Ok(())
}

#[test]
fn enter_after_the_first_block_splices_without_collecting_the_root_order() -> Result<(), Error> {
    for blocks in [50, 500, 5000] {
        let edit = Edit::InsertAfter {
            anchor: 0,
            count: 1,
        };
        let (outcome, work) = run(blocks, edit, false)?;
        let (general, _) = run(blocks, edit, true)?;
        assert_eq!(
            outcome, general,
            "new and old splice paths differ at {blocks}"
        );
        assert_eq!(work.splice.root_keys, 0, "splice root keys at {blocks}");
        assert_eq!(
            work.splice.root_steps, 1,
            "splice nearer-end steps at {blocks}"
        );
    }
    Ok(())
}

#[test]
fn detached_insertions_match_the_old_general_path_exactly() -> Result<(), Error> {
    let blocks = 9;
    let edits = [
        Edit::InsertAfter {
            anchor: 4,
            count: 1,
        },
        Edit::InsertAfter {
            anchor: 0,
            count: 3,
        },
        Edit::InsertAfter {
            anchor: 7,
            count: 1,
        },
        Edit::InsertAfter {
            anchor: 3,
            count: 2,
        },
        // One splice call with several nodes, at the start and in the middle.
        Edit::Splice { start: 0, count: 1 },
        Edit::Splice { start: 0, count: 3 },
        Edit::Splice { start: 5, count: 3 },
        Edit::Splice { start: 8, count: 2 },
    ];
    for edit in edits {
        let (outcome, work) = run(blocks, edit, false)?;
        let (general, _) = run(blocks, edit, true)?;
        assert_eq!(outcome, general, "{edit:?}");
        // The nearer-end walk follows at most half the root's links per located insertion.
        let insertions = match edit {
            Edit::InsertAfter { count, .. } => count,
            Edit::Splice { .. } => 1,
        };
        assert!(
            work.splice.root_steps <= insertions * blocks.div_ceil(2),
            "{edit:?}: {work:?}"
        );
    }
    Ok(())
}

#[test]
fn an_append_after_the_last_block_keeps_the_existing_append_path() -> Result<(), Error> {
    // The force switch only replaces the new detached-middle path, so both runs take the existing
    // append fast path here; this pins that the new path does not change appends.
    let edit = Edit::InsertAfter {
        anchor: 8,
        count: 1,
    };
    let (outcome, work) = run(9, edit, false)?;
    let (general, _) = run(9, edit, true)?;
    assert_eq!(outcome, general);
    assert_eq!(work.splice.root_steps, 0, "{work:?}");
    assert_eq!(work.splice.root_keys, 0, "{work:?}");
    Ok(())
}

#[test]
fn invalid_splices_fail_identically_in_both_paths() -> Result<(), Error> {
    for general in [false, true] {
        let (mut editor, paragraphs) = seed(4)?;
        let before = editor.state().clone();
        let _force = general.then(force_general_splice);
        let error = editor
            .update(|tx| tx.splice(paragraphs[0], ChildIndex(0), 0, &[NodeKey::ROOT]))
            .map(|_| ())
            .expect_err("splicing the root into a child");
        assert!(matches!(error, Error::AppendSelf), "{error:?}");
        let error = editor
            .update(|tx| {
                let paragraph = tx.create(Paragraph::default())?;
                tx.splice(NodeKey::ROOT, ChildIndex(9), 0, &[paragraph.key()])
            })
            .map(|_| ())
            .expect_err("out-of-range splice");
        assert!(matches!(error, Error::SpliceOutOfRange), "{error:?}");
        assert!(before.same_snapshot(editor.state()));
    }
    Ok(())
}

#[test]
fn an_equal_size_reorder_emits_and_a_same_place_reinsert_does_not() -> Result<(), Error> {
    let (mut editor, paragraphs) = seed(4)?;
    let (_, commit) = editor.update(|tx| tx.insert_after(paragraphs[2], paragraphs[1], true))?;
    let ops = commit.diff(&DiffOptions::default())?.ops;
    assert!(
        ops.contains(&DiffOp::Children {
            parent: NodeKey::ROOT,
            children: vec![paragraphs[0], paragraphs[2], paragraphs[1], paragraphs[3]],
        }),
        "{ops:?}"
    );
    let (_, commit) = editor.update(|tx| {
        tx.remove(paragraphs[3], false)?;
        tx.insert_after(paragraphs[1], paragraphs[3], false)?;
        Ok(())
    })?;
    let ops = commit.diff(&DiffOptions::default())?.ops;
    assert!(
        !ops.iter()
            .any(|op| matches!(op, DiffOp::Children { parent, .. } if *parent == NodeKey::ROOT)),
        "{ops:?}"
    );
    Ok(())
}

/// Foreign root paragraphs bound to genuine instances: the new path must make the same getter and
/// clone callbacks, in the same order, and fail the same way, as the old general path.
#[cfg(feature = "foreign-nodes")]
mod foreign {
    use super::*;
    use std::sync::{
        Arc, Mutex,
        atomic::{AtomicU32, Ordering},
    };

    #[derive(Default)]
    struct Log {
        calls: Mutex<Vec<String>>,
        fail_clone_of: Mutex<Option<(NodeKey, Arc<Error>)>>,
    }
    impl Log {
        fn push(&self, call: String) {
            self.calls.lock().expect("log").push(call);
        }
    }

    struct Getters(Arc<Log>);
    impl ForeignHooks for Getters {
        fn is_inline(&self, node: NodeView<'_>, _: &ForeignData) -> Override<bool> {
            self.0.push(format!("is_inline {:?}", node.key));
            Override::Inherit
        }
        fn can_be_empty(&self, node: NodeView<'_>, _: &ForeignData) -> Override<bool> {
            self.0.push(format!("can_be_empty {:?}", node.key));
            Override::Inherit
        }
        fn is_parent_required(&self, node: NodeView<'_>, _: &ForeignData) -> Override<bool> {
            self.0.push(format!("is_parent_required {:?}", node.key));
            Override::Inherit
        }
        fn is_shadow_root(&self, node: NodeView<'_>, _: &ForeignData) -> Override<bool> {
            self.0.push(format!("is_shadow_root {:?}", node.key));
            Override::Inherit
        }
        fn text_content(&self, node: NodeView<'_>, _: &ForeignData) -> Override<String> {
            self.0.push(format!("text_content {:?}", node.key));
            Override::Inherit
        }
    }

    struct Instances {
        log: Arc<Log>,
        next: AtomicU32,
    }
    impl ForeignInstanceHooks for Instances {
        fn validate_instance(&self, _: &str, _: &ForeignInstance) -> Result<(), Error> {
            Ok(())
        }
        fn clone_instance(
            &self,
            request: ForeignInstanceCloneRequest,
        ) -> Result<ForeignInstanceClone, Error> {
            self.log.push(format!(
                "clone {:?} {:?} -> {:?}",
                request.mode, request.constructor_key, request.destination_key
            ));
            if let Some((key, cause)) = &*self.log.fail_clone_of.lock().expect("log")
                && *key == request.constructor_key
            {
                return Err(Error::ForeignReadFailed(cause.clone()));
            }
            Ok(ForeignInstanceClone {
                instance: ForeignInstance::new(
                    request.destination_owner,
                    request.original.class_id(),
                    self.next.fetch_add(1, Ordering::SeqCst),
                )?,
                base: request.base,
                observed_links: request.required_links,
                payload: None,
                root_cache: None,
            })
        }
    }

    #[derive(Debug, PartialEq)]
    struct ForeignOutcome {
        /// Ops on success; on failure, whether the returned carrier holds the injected cause itself.
        result: Result<Vec<DiffOp>, bool>,
        calls: Vec<String>,
        json: String,
        links: Vec<(NodeKey, Links, ElementLinks)>,
        unchanged_after_failure: bool,
    }

    fn run_foreign(
        blocks: usize,
        anchor: usize,
        fail: Option<(usize, &Arc<Error>)>,
        general: bool,
    ) -> Result<ForeignOutcome, Error> {
        let log = Arc::new(Log::default());
        let mut editor = Editor::builder(EditorMode::ViewAttached)
            .foreign_node(ForeignNodeType {
                type_name: "probe-paragraph".into(),
                class_name: "ProbeParagraph".into(),
                kind: NodeKind::Element,
                extends: Some("paragraph"),
                required_state: vec![],
                hooks: Arc::new(Getters(log.clone())),
            })
            .build()
            .expect("editor");
        editor.install_foreign_instance_hooks(Arc::new(Instances {
            log: log.clone(),
            next: AtomicU32::new(1000),
        }))?;
        let (paragraphs, _) = editor.update(|tx| {
            let mut paragraphs = Vec::with_capacity(blocks);
            for index in 0..blocks {
                let paragraph = tx.create_foreign("probe-paragraph", SerializedNode::new())?;
                let text = tx.create_text(&format!("block {index}"))?;
                tx.append(paragraph, &[text.key()])?;
                paragraphs.push(paragraph);
            }
            tx.append(NodeKey::ROOT, &paragraphs)?;
            Ok(paragraphs)
        })?;
        let state = editor.state().clone();
        for (index, key) in paragraphs.iter().enumerate() {
            let identity = state.view().foreign_record_identity(*key)?;
            let instance = ForeignInstance::new(
                editor.foreign_instance_owner(),
                1,
                u32::try_from(index + 1).expect("small seed"),
            )?;
            state
                .view()
                .bind_foreign_instance(*key, &identity, instance)?;
        }
        log.calls.lock().expect("log").clear();
        *log.fail_clone_of.lock().expect("log") =
            fail.map(|(index, cause)| (paragraphs[index], cause.clone()));
        let before = editor.state().clone();
        let force = general.then(force_general_splice);
        let result = editor
            .update(|tx| {
                let paragraph = tx.create(Paragraph::default())?;
                tx.insert_after(paragraphs[anchor], paragraph.key(), true)?;
                Ok(())
            })
            .and_then(|(_, commit)| Ok(commit.diff(&DiffOptions::default())?.ops))
            .map_err(|error| match (&error, fail) {
                (Error::ForeignReadFailed(carried), Some((_, cause))) => {
                    Arc::ptr_eq(carried, cause)
                }
                _ => false,
            });
        drop(force);
        let unchanged_after_failure = result.is_err() && before.same_snapshot(editor.state());
        let calls = log.calls.lock().expect("log").clone();
        Ok(ForeignOutcome {
            result,
            calls,
            json: editor.state().to_json_string()?,
            links: links(editor.state()),
            unchanged_after_failure,
        })
    }

    #[test]
    fn bound_foreign_siblings_see_the_same_callbacks_and_failures_in_both_paths()
    -> Result<(), Error> {
        let blocks = 7;
        // One shared cause for both paths, so identity rather than equal text is compared.
        let cause = Arc::new(Error::Invariant("probe clone failed"));
        for (anchor, fail) in [
            (0, None),
            (3, None),
            // The previous sibling clones first, the next sibling after the inserted node.
            (3, Some(3)),
            (3, Some(4)),
            (0, Some(1)),
        ] {
            let fail = fail.map(|index| (index, &cause));
            let new = run_foreign(blocks, anchor, fail, false)?;
            let old = run_foreign(blocks, anchor, fail, true)?;
            assert_eq!(new, old, "anchor {anchor} fail {fail:?}");
            assert!(
                new.calls.iter().any(|call| call.starts_with("clone")),
                "bound siblings must clone on write: {new:?}"
            );
            match &new.result {
                Ok(_) => assert!(fail.is_none(), "{new:?}"),
                Err(identical) => assert!(
                    fail.is_some() && *identical,
                    "the returned carrier must hold the injected cause: {new:?}"
                ),
            }
            assert_eq!(new.unchanged_after_failure, fail.is_some(), "{new:?}");
        }
        Ok(())
    }
}
