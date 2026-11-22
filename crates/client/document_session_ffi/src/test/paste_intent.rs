use super::*;

#[test]
fn captured_native_paste_intent_keeps_rich_entries_files_and_html_independent() {
    for plain_only in [false, true] {
        let input = FfiInput::Paste {
            payload: FfiClipboardPayload {
                data: vec![
                    FfiClipboardEntry {
                        mime: "text/html".into(),
                        text: "<b>rich</b>".into(),
                    },
                    FfiClipboardEntry {
                        mime: "text/plain".into(),
                        text: "**literal**".into(),
                    },
                ],
                has_files: true,
                html_nodes: Some(vec![serde_json::Map::new()]),
                intent: PasteIntent { plain_only },
            },
            selection: ViewSelection::KeepModel,
        };
        let SessionInput::Editor(Input::Command {
            command: Command::Paste(payload),
            selection: ViewSelection::KeepModel,
        }) = input.native()
        else {
            panic!("typed paste")
        };
        assert_eq!(payload.intent.plain_only, plain_only);
        assert!(payload.has_files);
        assert_eq!(payload.html_nodes, Some(vec![serde_json::Map::new()]));
        assert_eq!(
            payload.data.keys().map(String::as_str).collect::<Vec<_>>(),
            ["text/html", "text/plain"]
        );
        assert_eq!(payload.data["text/html"], "<b>rich</b>");
        assert_eq!(payload.data["text/plain"], "**literal**");
    }
}
