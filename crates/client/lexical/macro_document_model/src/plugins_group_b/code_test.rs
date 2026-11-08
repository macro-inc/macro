use super::*;
use crate::nodes::{CustomCodeNode, create_custom_code_node, set_custom_code};
use crate::{EditorType, surface};

#[test]
fn code_preview_commands_keep_the_node_and_delete_to_a_live_following_caret() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (code, _) = editor.update(|tx| {
        let code = create_custom_code_node(tx, Some("svg"))?;
        set_custom_code(tx, code, Some("svg"), "<svg/>")?;
        tx.append(NodeKey::ROOT, &[code.key()])?;
        tx.select_end(code)?;
        Ok(code)
    })?;
    let command = decode_command(
        "group-b.code",
        &format!(
            "{{\"action\":\"preview\",\"key\":{},\"enabled\":true}}",
            code.key().index()
        ),
        code.key().generation(),
        None,
    )?
    .expect("code command");
    assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
    assert!(
        editor
            .state()
            .view()
            .get::<CustomCodeNode>(code)
            .expect("code")
            .preview_enabled
    );
    let command = decode_command(
        "group-b.code",
        &format!(
            "{{\"action\":\"language\",\"key\":{},\"language\":\"rust\"}}",
            code.key().index()
        ),
        code.key().generation(),
        None,
    )?
    .expect("language command");
    editor.dispatch(&command)?;
    assert_eq!(
        editor
            .state()
            .view()
            .get::<CustomCodeNode>(code)
            .expect("code")
            .code
            .language(),
        Some("rust")
    );
    assert!(
        !editor
            .state()
            .view()
            .get::<CustomCodeNode>(code)
            .expect("code")
            .preview_enabled
    );
    let command = decode_command(
        "group-b.code",
        &format!("{{\"action\":\"delete\",\"key\":{}}}", code.key().index()),
        code.key().generation(),
        None,
    )?
    .expect("delete command");
    editor.dispatch(&command)?;
    let state = editor.state().view();
    let blocks = state.children_keys(NodeKey::ROOT)?;
    assert_eq!(blocks.len(), 1);
    assert!(state.is::<Paragraph>(blocks[0]));
    assert_eq!(
        state.top_level_element(
            editor
                .state()
                .selection()
                .and_then(Selection::as_range)
                .expect("selection")
                .anchor
                .key()
        )?,
        Some(blocks[0])
    );
    Ok(())
}

#[test]
fn code_select_all_escalates_only_when_its_complete_text_is_already_selected() -> Result<(), Error>
{
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (code, _) = editor.update(|tx| {
        let code = create_custom_code_node(tx, Some("rust"))?;
        set_custom_code(tx, code, Some("rust"), "let n = 1;")?;
        tx.append(NodeKey::ROOT, &[code.key()])?;
        tx.select_start(code)?;
        Ok(code)
    })?;
    assert_eq!(editor.dispatch(&Command::SelectAll(None))?.0, Handled::Yes);
    let range = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert_eq!(range.text_content(editor.state().view())?, "let n = 1;");
    assert_eq!(range.anchor.key(), code.key());
    assert_eq!(editor.dispatch(&Command::SelectAll(None))?.0, Handled::No);
    Ok(())
}

#[test]
fn tab_in_code_inserts_a_literal_tab_and_keeps_block_indentation_zero() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (code, _) = editor.update(|tx| {
        let code = create_custom_code_node(tx, Some("rust"))?;
        set_custom_code(tx, code, Some("rust"), "value")?;
        tx.append(NodeKey::ROOT, &[code.key()])?;
        tx.select_start(code)?;
        Ok(code)
    })?;
    editor.dispatch(&Command::Key {
        command: KeyCommand::Tab,
        event: Some(KeyEvent::default()),
    })?;
    assert_eq!(editor.state().view().text_content(code), "\tvalue");
    assert_eq!(editor.state().view().indent(code), 0);
    Ok(())
}

#[test]
fn code_edge_arrows_insert_a_caret_before_the_first_block_and_leave_middle_lines_native()
-> Result<(), Error> {
    use lexical_rich_nodes::code::CodeHighlightNode;
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (code, highlight) = editor
        .update(|tx| {
            let code = create_custom_code_node(tx, Some("rust"))?;
            let highlight = tx.create(CodeHighlightNode::default())?;
            tx.text(highlight)?.set_text_content("first")?;
            let middle = tx.create(CodeHighlightNode::default())?;
            tx.text(middle)?.set_text_content("middle")?;
            let last = tx.create(CodeHighlightNode::default())?;
            tx.text(last)?.set_text_content("last")?;
            let br = tx.create(LineBreak {})?;
            let br2 = tx.create(LineBreak {})?;
            tx.append(
                code,
                &[
                    highlight.key(),
                    br.key(),
                    middle.key(),
                    br2.key(),
                    last.key(),
                ],
            )?;
            tx.append(NodeKey::ROOT, &[code.key()])?;
            tx.select_start(middle)?;
            Ok((code, highlight))
        })?
        .0;
    let up = Command::Key {
        command: KeyCommand::ArrowUp,
        event: None,
    };
    assert_eq!(editor.dispatch(&up)?.0, Handled::No);
    assert_eq!(
        editor.state().view().first_child(NodeKey::ROOT),
        Some(code.key())
    );
    editor.update(|tx| tx.select_start(code))?;
    assert_eq!(editor.dispatch(&up)?.0, Handled::Yes);
    let state = editor.state().view();
    let first = state.first_child(NodeKey::ROOT).expect("caret block");
    assert!(state.is::<Paragraph>(first));
    assert_eq!(
        editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("caret")
            .anchor
            .key(),
        code.key()
    );
    editor.update(|tx| tx.select_start(highlight))?;
    assert_eq!(editor.dispatch(&up)?.0, Handled::Yes);
    assert_eq!(editor.state().view().children_keys(NodeKey::ROOT)?.len(), 3);
    Ok(())
}

#[test]
fn fresh_code_text_uses_edge_navigation_without_model_highlight_nodes() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (code, text) = editor
        .update(|tx| {
            let code = create_custom_code_node(tx, Some("rust"))?;
            set_custom_code(tx, code, Some("rust"), "let n = 1;")?;
            tx.append(NodeKey::ROOT, &[code.key()])?;
            let text = tx.first_child(code).expect("plain code text");
            assert_eq!(tx.type_name(text)?, "text");
            tx.select_start(text)?;
            Ok((code, text))
        })?
        .0;
    assert_eq!(
        editor
            .dispatch(&Command::Key {
                command: KeyCommand::ArrowUp,
                event: None
            })?
            .0,
        Handled::Yes
    );
    assert!(
        editor.state().view().is::<Paragraph>(
            editor
                .state()
                .view()
                .first_child(NodeKey::ROOT)
                .expect("leading paragraph")
        )
    );
    assert_eq!(editor.state().view().parent(text), Some(code.key()));
    assert_eq!(editor.state().view().type_name(text)?, "text");
    Ok(())
}
