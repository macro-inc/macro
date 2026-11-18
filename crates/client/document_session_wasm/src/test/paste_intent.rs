use super::*;

fn envelope(intent: Option<bool>, html: &str) -> wire::EditorInputMsg {
    let selection = editor_input::view_selection(&ViewSelection::Range {
        anchor: Point::text(editor_input::key(7, 19), Utf16Offset(2)),
        focus: Point::text(editor_input::key(8, 19), Utf16Offset(4)),
        resolution_dirty: true,
    });
    let clipboard = vec![
        wire::ClipboardEntryMsg {
            mime: "text/plain".into(),
            value: "**literal**".into(),
        },
        wire::ClipboardEntryMsg {
            mime: "text/html".into(),
            value: "<p>rich</p>".into(),
        },
    ];
    if let Some(plain_only) = intent {
        wire::EditorInputMsg::EditorPasteWithIntent {
            selection,
            clipboard,
            has_files: true,
            html_nodes: vec![html.into()],
            intent: wire::PasteIntentMsg { plain_only },
        }
    } else {
        wire::EditorInputMsg::EditorPaste {
            selection,
            clipboard,
            has_files: true,
            html_nodes: vec![html.into()],
        }
    }
}

#[test]
fn paste_branches_preserve_payload_and_selection_with_exact_typed_intent(
) -> Result<(), BoundaryError> {
    for intent in [None, Some(false), Some(true)] {
        let message = envelope(intent, r#"{"type":"paragraph","children":[]}"#);
        let decoded = wire::EditorInputMsg::deserialize(&bytes(&message)?)?;
        let Input::Command {
            command: Command::Paste(payload),
            selection,
        } = editor_input::input(decoded, 19)?
        else {
            panic!("paste command");
        };
        assert_eq!(payload.intent.plain_only, intent.unwrap_or(false));
        assert_eq!(payload.data["text/plain"], "**literal**");
        assert_eq!(payload.data["text/html"], "<p>rich</p>");
        assert!(payload.has_files);
        assert_eq!(payload.html_nodes.as_ref().unwrap()[0]["type"], "paragraph");
        let ViewSelection::Range {
            anchor,
            focus,
            resolution_dirty,
        } = selection
        else {
            panic!("range");
        };
        assert_eq!(
            anchor,
            Point::text(editor_input::key(7, 19), Utf16Offset(2))
        );
        assert_eq!(focus, Point::text(editor_input::key(8, 19), Utf16Offset(4)));
        assert!(resolution_dirty);
    }
    Ok(())
}

#[test]
fn both_paste_branches_reject_invalid_constructor_json() {
    for intent in [None, Some(false), Some(true)] {
        assert!(editor_input::input(envelope(intent, "invalid JSON"), 19).is_err());
    }
}
