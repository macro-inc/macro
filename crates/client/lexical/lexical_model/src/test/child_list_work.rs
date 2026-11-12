//! Enter-shaped root insertions: the root's child-order work does not grow with unaffected siblings,
//! and every insertion matches the general splice path on an identical seed.
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

#[derive(Debug, PartialEq)]
struct Outcome {
    json: String,
    links: Vec<(
        NodeKey,
        Links,
        Option<(Option<NodeKey>, Option<NodeKey>, u32)>,
    )>,
    dirty_leaves: Vec<NodeKey>,
    dirty_elements: Vec<(NodeKey, DirtyIntent)>,
    selection: Option<Selection>,
    ops: Vec<DiffOp>,
}

#[derive(Debug)]
struct Work {
    diff: ChildWork,
    splice: ChildWork,
    unscoped: ChildWork,
}

/// Insert `count` new paragraphs after root child `anchor` (the virtual `insert_after`, as Enter
/// does), optionally forcing the general splice path, and record the result and child work.
fn insert(
    blocks: usize,
    anchor: usize,
    count: usize,
    general: bool,
) -> Result<(Outcome, Work), Error> {
    let (mut editor, paragraphs) = seed(blocks)?;
    let measurement = Measurement::start();
    let force = general.then(force_general_splice);
    let ((dirty_leaves, dirty_elements), commit) = editor.update(|tx| {
        let mut after = paragraphs[anchor];
        for _ in 0..count {
            let paragraph = tx.create(Paragraph::default())?;
            after = tx.insert_after(after, paragraph.key(), true)?;
        }
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
    let view = commit.next.view();
    let mut links = commit
        .next
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
    let outcome = Outcome {
        json: commit.next.to_json_string()?,
        links,
        dirty_leaves,
        dirty_elements,
        selection: view.selection().cloned(),
        ops,
    };
    Ok((outcome, work))
}

#[test]
fn enter_after_the_first_block_does_root_child_work_independent_of_document_size()
-> Result<(), Error> {
    let mut residuals = Vec::new();
    for blocks in [50, 500, 5000] {
        let (outcome, work) = insert(blocks, 0, 1, false)?;
        let (general, _) = insert(blocks, 0, 1, true)?;
        assert_eq!(
            outcome, general,
            "fast and general splice paths differ at {blocks}"
        );
        // The host contract sends the complete next root order once; nothing else of the root
        // is collected, and the previous order is read only up to its first difference.
        assert_eq!(
            work.diff.root_keys,
            blocks + 1,
            "diff root keys at {blocks}"
        );
        assert_eq!(
            work.diff.root_steps, 2,
            "diff previous-order reads at {blocks}"
        );
        assert_eq!(work.splice.root_keys, 0, "splice root keys at {blocks}");
        assert_eq!(
            work.splice.root_steps, 1,
            "splice nearer-end steps at {blocks}"
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
fn middle_start_end_and_multi_node_insertions_match_the_general_path() -> Result<(), Error> {
    let blocks = 9;
    for (anchor, count) in [(4, 1), (0, 3), (7, 1), (blocks - 1, 1), (3, 2)] {
        let (outcome, work) = insert(blocks, anchor, count, false)?;
        let (general, _) = insert(blocks, anchor, count, true)?;
        assert_eq!(outcome, general, "anchor {anchor} count {count}");
        // A middle insertion walks from the nearer end: at most half the children per node.
        assert!(
            work.splice.root_steps <= count * blocks.div_ceil(2),
            "anchor {anchor} count {count}: {work:?}"
        );
    }
    Ok(())
}

#[test]
fn insertion_at_the_start_and_invalid_splices_match_the_general_path() -> Result<(), Error> {
    for general in [false, true] {
        let (mut editor, paragraphs) = seed(4)?;
        let _force = general.then(force_general_splice);
        let (first, commit) = editor.update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            tx.splice(NodeKey::ROOT, ChildIndex(0), 0, &[paragraph.key()])?;
            Ok(paragraph.key())
        })?;
        assert_eq!(commit.next.view().first_child(NodeKey::ROOT), Some(first));
        assert_eq!(commit.next.view().children_size(NodeKey::ROOT), 5);
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
