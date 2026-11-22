use super::*;
use crate::{EditorType, nodes::set_task_list_view_settings};
use std::sync::Arc;

#[test]
fn root_checklist_collection_preserves_wrapper_ownership_settings_and_saved_state()
-> Result<(), Error> {
    let mut editor =
        crate::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("registry");
    let ((list, leading, row, trailing), _) = editor.update(|tx| {
        let bullet = tx.create(ListNode::new(ListType::Bullet, 1))?;
        let bullet_item = tx.create(ListItemNode::default())?;
        let bullet_text = tx.create_text("Bullet")?;
        tx.append(bullet_item, &[bullet_text.key()])?;
        tx.append(bullet, &[bullet_item.key()])?;
        let paragraph = tx.create(Paragraph::default())?;
        let list = tx.create(ListNode::new(ListType::Check, 1))?;
        let leading = tx.create(ListItemNode::default())?;
        let nested_before = tx.create(ListNode::new(ListType::Bullet, 1))?;
        tx.append(leading, &[nested_before.key()])?;
        let row = tx.create(ListItemNode {
            checked: Some(true),
            ..Default::default()
        })?;
        let text = tx.create_text("\u{feff} Work!!  \n")?;
        tx.append(row, &[text.key()])?;
        let trailing = tx.create(ListItemNode::default())?;
        let nested_after = tx.create(ListNode::new(ListType::Check, 1))?;
        let nested_item = tx.create(ListItemNode::default())?;
        let nested_text = tx.create_text("Nested")?;
        tx.append(nested_item, &[nested_text.key()])?;
        tx.append(nested_after, &[nested_item.key()])?;
        tx.append(trailing, &[nested_after.key()])?;
        tx.append(list, &[leading.key(), row.key(), trailing.key()])?;
        tx.append(NodeKey::ROOT, &[bullet.key(), paragraph.key(), list.key()])?;
        set_task_list_view_settings(
            tx,
            list.key(),
            Arc::new(serde_json::json!({"filters":{"status":["done"]},"future":{"keep":true}})),
        )?;
        Ok((list.key(), leading.key(), row.key(), trailing.key()))
    })?;
    let before = editor.state().to_json()?;
    let metadata = collect_checklist_metadata(editor.state())?;
    assert_eq!(metadata.len(), 1);
    assert_eq!(metadata[0].list_key, list);
    assert_eq!(
        metadata[0].settings.as_ref(),
        &serde_json::json!({"filters":{"status":["done"]},"future":{"keep":true}})
    );
    assert_eq!(
        metadata[0].items,
        vec![ChecklistItemMeta {
            key: row,
            leading_keys: vec![leading],
            attached_keys: vec![trailing],
            checked: true,
            text: "Work!!".into(),
            mention_assignees: vec![],
            mention_due: Maybe::Null,
            marker_priority: Some(TaskPriority::High),
            task_id: Maybe::Null,
        }]
    );
    assert_eq!(editor.state().to_json()?, before);
    Ok(())
}

#[test]
fn mention_collection_deduplicates_in_order_and_recomputes_after_removal() -> Result<(), Error> {
    let mut editor =
        crate::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("registry");
    let ((row, first_date, first_task), _) = editor.update(|tx| {
        let list = tx.create(ListNode::new(ListType::Check, 1))?;
        let row = tx.create(ListItemNode::default())?;
        let first = tx.create(UserMentionNode {
            user_id: Maybe::Value("person-a".into()),
            display_name: "First label".into(),
            ..Default::default()
        })?;
        let second = tx.create(UserMentionNode {
            user_id: Maybe::Value("person-b".into()),
            display_name: "Second label".into(),
            ..Default::default()
        })?;
        let duplicate = tx.create(UserMentionNode {
            user_id: Maybe::Value("person-a".into()),
            display_name: "Changed label".into(),
            ..Default::default()
        })?;
        let first_date = tx.create(DateMentionNode {
            date: Maybe::Value("2030-05-14".into()),
            display_format: Maybe::Value("date".into()),
            ..Default::default()
        })?;
        let later_date = tx.create(DateMentionNode {
            date: Maybe::Value("2030-05-15".into()),
            ..Default::default()
        })?;
        let ordinary = tx.create(DocumentMentionNode {
            document_id: Maybe::Value("ordinary".into()),
            block_name: Maybe::Value("md".into()),
            ..Default::default()
        })?;
        let first_task = tx.create(DocumentMentionNode {
            document_id: Maybe::Value("first-task".into()),
            block_name: Maybe::Value("task".into()),
            ..Default::default()
        })?;
        let later_task = tx.create(DocumentMentionNode {
            document_id: Maybe::Value("second-task".into()),
            block_name: Maybe::Value("task".into()),
            ..Default::default()
        })?;
        let text = tx.create_text(" Work!!! ")?;
        tx.append(
            row,
            &[
                first.key(),
                second.key(),
                duplicate.key(),
                first_date.key(),
                later_date.key(),
                ordinary.key(),
                first_task.key(),
                later_task.key(),
                text.key(),
            ],
        )?;
        tx.append(list, &[row.key()])?;
        tx.append(NodeKey::ROOT, &[list.key()])?;
        Ok((row.key(), first_date.key(), first_task.key()))
    })?;
    let metadata = collect_checklist_metadata(editor.state())?;
    let item = &metadata[0].items[0];
    assert_eq!(
        item.mention_assignees,
        vec![
            ChecklistAssignee {
                id: Maybe::Value("person-a".into()),
                name: "First label".into()
            },
            ChecklistAssignee {
                id: Maybe::Value("person-b".into()),
                name: "Second label".into()
            },
        ]
    );
    assert_eq!(item.mention_due, Maybe::Value("2030-05-14".into()));
    assert_eq!(item.task_id, Maybe::Value("first-task".into()));
    assert_eq!(item.marker_priority, Some(TaskPriority::Urgent));
    assert!(editor.state().view().is_attached(first_date));
    assert!(editor.state().view().is_attached(first_task));
    editor.update(|tx| {
        tx.clear(row)?;
        let text = tx.create_text("  Changed!  ")?;
        tx.append(row, &[text.key()])
    })?;
    let metadata = collect_checklist_metadata(editor.state())?;
    let item = &metadata[0].items[0];
    assert_eq!(item.text, "Changed!");
    assert_eq!(item.marker_priority, Some(TaskPriority::Medium));
    assert_eq!(item.mention_assignees, vec![]);
    assert_eq!(item.mention_due, Maybe::Null);
    assert_eq!(item.task_id, Maybe::Null);
    Ok(())
}

#[test]
fn nullish_mentions_advance_to_the_first_defined_value_including_empty_strings() -> Result<(), Error>
{
    let mut editor =
        crate::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("registry");
    editor.update(|tx| {
        let list = tx.create(ListNode::new(ListType::Check, 1))?;
        let row = tx.create(ListItemNode::default())?;
        let absent = tx.create(DateMentionNode::default())?;
        let null = tx.create(DateMentionNode {
            date: Maybe::Null,
            ..Default::default()
        })?;
        let empty = tx.create(DateMentionNode {
            date: Maybe::Value(String::new()),
            ..Default::default()
        })?;
        let later = tx.create(DateMentionNode {
            date: Maybe::Value("2030-05-14".into()),
            ..Default::default()
        })?;
        let missing_task = tx.create(DocumentMentionNode {
            block_name: Maybe::Value("task".into()),
            ..Default::default()
        })?;
        let empty_task = tx.create(DocumentMentionNode {
            block_name: Maybe::Value("task".into()),
            document_id: Maybe::Value(String::new()),
            ..Default::default()
        })?;
        let later_task = tx.create(DocumentMentionNode {
            block_name: Maybe::Value("task".into()),
            document_id: Maybe::Value("later-task".into()),
            ..Default::default()
        })?;
        tx.append(
            row,
            &[
                absent.key(),
                null.key(),
                empty.key(),
                later.key(),
                missing_task.key(),
                empty_task.key(),
                later_task.key(),
            ],
        )?;
        tx.append(list, &[row.key()])?;
        tx.append(NodeKey::ROOT, &[list.key()])
    })?;
    let metadata = collect_checklist_metadata(editor.state())?;
    assert_eq!(
        metadata[0].items[0].mention_due,
        Maybe::Value(String::new())
    );
    assert_eq!(metadata[0].items[0].task_id, Maybe::Value(String::new()));
    Ok(())
}

#[test]
fn marker_parser_uses_ecmascript_whitespace_and_the_last_three_bangs() {
    for (text, expected) in [
        ("Work", None),
        ("Work ! remains", None),
        ("Work!", Some(TaskPriority::Medium)),
        ("Work!!", Some(TaskPriority::High)),
        ("Work!!!", Some(TaskPriority::Urgent)),
        ("Work!!!!", Some(TaskPriority::Urgent)),
        ("Work!!  \n", Some(TaskPriority::High)),
        ("Work!\u{feff}", Some(TaskPriority::Medium)),
        ("Work!\u{85}", None),
    ] {
        assert_eq!(parse_marker_priority(text), expected, "{text:?}");
    }
}

#[test]
fn absent_legacy_date_and_task_ids_remain_absent_instead_of_becoming_null() -> Result<(), Error> {
    let mut editor =
        crate::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("registry");
    editor.update(|tx| {
        let list = tx.create(ListNode::new(ListType::Check, 1))?;
        let row = tx.create(ListItemNode::default())?;
        let date = tx.create(DateMentionNode {
            display_format: Maybe::Value("Missing date".into()),
            ..Default::default()
        })?;
        let task = tx.create(DocumentMentionNode {
            block_name: Maybe::Value("task".into()),
            document_name: Maybe::Value("Missing task".into()),
            ..Default::default()
        })?;
        tx.append(row, &[date.key(), task.key()])?;
        tx.append(list, &[row.key()])?;
        tx.append(NodeKey::ROOT, &[list.key()])
    })?;
    let metadata = collect_checklist_metadata(editor.state())?;
    assert_eq!(metadata[0].items[0].mention_due, Maybe::Missing);
    assert_eq!(metadata[0].items[0].task_id, Maybe::Missing);
    Ok(())
}

#[test]
fn per_list_collection_equals_bulk_union_and_preserves_unknown_settings() -> Result<(), Error> {
    let mut editor =
        crate::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("registry");
    let ((first, paragraph, second, nested, detached), _) = editor.update(|tx| {
        let first = tx.create(ListNode::new(ListType::Check, 1))?;
        let row = tx.create(ListItemNode {
            checked: Some(true),
            ..Default::default()
        })?;
        let text = tx.create_text("First!")?;
        tx.append(row, &[text.key()])?;
        tx.append(first, &[row.key()])?;
        let paragraph = tx.create(Paragraph::default())?;
        let second = tx.create(ListNode::new(ListType::Check, 1))?;
        let wrapper = tx.create(ListItemNode::default())?;
        let nested = tx.create(ListNode::new(ListType::Check, 1))?;
        let nested_row = tx.create(ListItemNode::default())?;
        let nested_text = tx.create_text("Nested")?;
        tx.append(nested_row, &[nested_text.key()])?;
        tx.append(nested, &[nested_row.key()])?;
        tx.append(wrapper, &[nested.key()])?;
        let second_row = tx.create(ListItemNode::default())?;
        let second_text = tx.create_text("Second!!")?;
        tx.append(second_row, &[second_text.key()])?;
        tx.append(second, &[wrapper.key(), second_row.key()])?;
        let detached = tx.create(ListNode::new(ListType::Check, 1))?;
        tx.append(NodeKey::ROOT, &[first.key(), paragraph.key(), second.key()])?;
        set_task_list_view_settings(
            tx,
            second.key(),
            Arc::new(serde_json::json!({"filters":{"future":["keep"]},"unknown":{"raw":true}})),
        )?;
        Ok((
            first.key(),
            paragraph.key(),
            second.key(),
            nested.key(),
            detached.key(),
        ))
    })?;
    let before = editor.state().to_json()?;
    let bulk = collect_checklist_metadata(editor.state())?;
    assert_eq!(
        bulk.iter().map(|meta| meta.list_key).collect::<Vec<_>>(),
        vec![first, second]
    );
    let mut per_list = Vec::new();
    for key in editor.state().view().children(NodeKey::ROOT) {
        if let Some(meta) = collect_checklist_metadata_for_list(editor.state(), key)? {
            per_list.push(meta);
        }
    }
    assert_eq!(per_list, bulk);
    assert_eq!(
        per_list[1].settings.as_ref(),
        &serde_json::json!({"filters":{"future":["keep"]},"unknown":{"raw":true}})
    );
    for key in [NodeKey::ROOT, paragraph, nested, detached] {
        assert_eq!(
            collect_checklist_metadata_for_list(editor.state(), key)?,
            None
        );
    }
    assert_eq!(editor.state().to_json()?, before);
    Ok(())
}
