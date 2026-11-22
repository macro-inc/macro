use super::*;
use crate::{
    EditorType,
    nodes::{Maybe, create_comment_node},
    preset_builder,
};

#[test]
fn plain_typing_does_no_mark_work_at_small_medium_and_large_sizes() -> crate::Result<()> {
    let mut observed = Vec::new();
    for node_count in [190, 3835, 36530] {
        let mut editor = preset_builder(EditorType::MarkdownSync).build()?;
        let groups = (node_count - 1) / 12;
        let (text, _) = editor.update(|tx| {
            let mut blocks = Vec::new();
            let mut plain_paragraphs = Vec::new();
            let mut selected = NodeKey::ROOT;
            for index in 0..groups {
                let marked = tx.create(Paragraph::default())?;
                let mark =
                    create_comment_node(tx, vec!["draft".into()], Maybe::Value(42), Some(true))?;
                let marked_text = tx.create_text("marked")?;
                tx.append(mark, &[marked_text.key()])?;
                tx.append(marked, &[mark.key()])?;
                let plain = tx.create(Paragraph::default())?;
                let text = tx.create_text("plain")?;
                tx.append(plain, &[text.key()])?;
                if index == groups / 2 {
                    selected = text.key();
                }
                plain_paragraphs.push(plain.key());
                let code = tx.create(lexical_rich_nodes::code::CodeNode::default())?;
                let code_text = tx.create_text("let x = 1;")?;
                tx.append(code, &[code_text.key()])?;
                let table = tx.create(lexical_rich_nodes::table::TableNode::default())?;
                let row = tx.create(lexical_rich_nodes::table::TableRowNode::default())?;
                let cell = tx.create(lexical_rich_nodes::table::TableCellNode::default())?;
                let cell_paragraph = tx.create(Paragraph::default())?;
                let cell_text = tx.create_text("cell")?;
                tx.append(cell_paragraph, &[cell_text.key()])?;
                tx.append(cell, &[cell_paragraph.key()])?;
                tx.append(row, &[cell.key()])?;
                tx.append(table, &[row.key()])?;
                blocks.extend([marked.key(), plain.key(), code.key(), table.key()]);
            }
            let remaining = node_count - 1 - groups * 12;
            for _ in 0..remaining / 2 {
                let paragraph = tx.create(Paragraph::default())?;
                let text = tx.create_text("padding")?;
                tx.append(paragraph, &[text.key()])?;
                blocks.push(paragraph.key());
            }
            if remaining % 2 != 0 {
                let extra = tx.create_text("bold")?;
                tx.text(extra)?.set_format(TextFormat::BOLD)?;
                tx.append(plain_paragraphs[0], &[extra.key()])?;
            }
            tx.append(NodeKey::ROOT, &blocks)?;
            Ok(selected)
        })?;
        assert_eq!(editor.state().node_count(), node_count);
        assert_eq!(editor.extension::<DraftCommentMarks>()?.count, groups);
        let previous = editor.state().clone();
        let extension = std::ptr::from_ref(editor.extension::<DraftCommentMarks>()?);
        WORK.with(|work| *work.borrow_mut() = (0, 0));
        editor.update(|tx| {
            tx.text(text)?.set_text_content("plainx")?;
            Ok(())
        })?;
        let work = WORK.with(|work| *work.borrow());
        assert_eq!(
            work.1, 0,
            "unmarked typing visited a comment at {node_count}"
        );
        assert!(
            work.0 <= 4,
            "unbounded draft-count reads at {node_count}: {work:?}"
        );
        observed.push(work);
        assert_eq!(
            extension,
            std::ptr::from_ref(editor.extension::<DraftCommentMarks>()?)
        );
        assert_eq!(editor.extension::<DraftCommentMarks>()?.count, groups);
        assert_eq!(previous.view().text_content(text), "plain");
        assert_eq!(editor.state().view().text_content(text), "plainx");
    }
    assert_eq!(observed, vec![(2, 0), (2, 0), (2, 0)]);
    Ok(())
}

#[test]
fn draft_count_tracks_flag_changes_moves_clean_subtree_deletion_and_unwrap() -> crate::Result<()> {
    let mut editor = preset_builder(EditorType::MarkdownSync).build()?;
    let ((paragraph, destination, draft, posted), _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let destination = tx.create(Paragraph::default())?;
        let draft = create_comment_node(tx, vec!["draft".into()], Maybe::Value(42), Some(true))?;
        let posted = create_comment_node(tx, vec!["posted".into()], Maybe::Value(43), Some(false))?;
        let first = tx.create_text("first")?;
        let second = tx.create_text("second")?;
        let other = tx.create_text("elsewhere")?;
        tx.append(draft, &[first.key()])?;
        tx.append(posted, &[second.key()])?;
        tx.append(paragraph, &[draft.key(), posted.key()])?;
        tx.append(destination, &[other.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key(), destination.key()])?;
        Ok((
            paragraph.key(),
            destination.key(),
            draft.key(),
            posted.key(),
        ))
    })?;
    assert_eq!(editor.extension::<DraftCommentMarks>()?.count, 1);
    editor.update(|tx| {
        tx.get_mut::<CommentNode>(posted)?.is_draft = true;
        Ok(())
    })?;
    assert_eq!(editor.extension::<DraftCommentMarks>()?.count, 2);
    editor.update(|tx| {
        tx.get_mut::<CommentNode>(posted)?.is_draft = false;
        Ok(())
    })?;
    assert_eq!(editor.extension::<DraftCommentMarks>()?.count, 1);
    editor.update(|tx| {
        tx.get_mut::<CommentNode>(posted)?.is_draft = true;
        Ok(())
    })?;
    assert_eq!(editor.extension::<DraftCommentMarks>()?.count, 2);
    editor.update(|tx| {
        tx.append(destination, &[draft])?;
        Ok(())
    })?;
    assert_eq!(editor.extension::<DraftCommentMarks>()?.count, 2);
    let before_delete = editor.state().clone();
    editor.update(|tx| tx.remove(paragraph, true))?;
    assert_eq!(editor.extension::<DraftCommentMarks>()?.count, 1);
    assert!(before_delete.view().get::<CommentNode>(posted).is_some());
    assert!(editor.state().view().get::<CommentNode>(posted).is_none());
    editor.update(|tx| {
        for child in tx.children_keys(draft)? {
            tx.insert_before(draft, child, true)?;
        }
        tx.remove(draft, true)
    })?;
    assert_eq!(editor.extension::<DraftCommentMarks>()?.count, 0);
    assert_eq!(
        editor.state().root_text_content().as_ref(),
        "elsewherefirst"
    );
    Ok(())
}

#[test]
fn draft_count_rebuilds_snapshot_replacement_and_counts_each_published_prefix_once()
-> crate::Result<()> {
    let mut editor = preset_builder(EditorType::MarkdownSync).build()?;
    let raw = serde_json::from_value(
        serde_json::json!({"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[{"type":"comment-mark","version":1,"ids":["one"],"isDraft":true,"children":[{"type":"text","version":1,"text":"one"}]},{"type":"comment-mark","version":1,"ids":["two"],"isDraft":true,"children":[{"type":"text","version":1,"text":"two"}]}]}]}}),
    )?;
    let snapshot = editor.parse_editor_state(&raw)?;
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let mark = create_comment_node(tx, vec!["prefix".into()], Maybe::Value(44), Some(true))?;
        let text = tx.create_text("prefix")?;
        tx.append(mark, &[text.key()])?;
        tx.append(paragraph, &[mark.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.set_editor_state(snapshot, TagSet::default())
    })?;
    assert_eq!(editor.extension::<DraftCommentMarks>()?.count, 2);
    let saved = editor.state().clone();
    let raw = serde_json::from_value(
        serde_json::json!({"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":"clear"}]}]}}),
    )?;
    let clear = editor.parse_editor_state(&raw)?;
    editor.set_editor_state(clear, TagSet::default())?;
    assert_eq!(editor.extension::<DraftCommentMarks>()?.count, 0);
    editor.set_editor_state(saved, TagSet::default())?;
    assert_eq!(editor.extension::<DraftCommentMarks>()?.count, 2);
    assert_eq!(editor.state().root_text_content().as_ref(), "onetwo");
    Ok(())
}
