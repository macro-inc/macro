//! Lower abstract edits to actual session commands against the live model selection.
use crate::{EditorOp, client::resolve::resolve};
use lexical_model::*;

pub(super) fn editing_input(state: &EditorState, op: &EditorOp, headless: bool) -> Option<Input> {
    let (from, to, commands) = match op {
        EditorOp::SetBlock { at, .. }
        | EditorOp::InsertTable { at, .. }
        | EditorOp::PasteMarkdown { at, .. } => (
            *at,
            *at,
            vec![Command::Extension(ExtensionCommand::new(
                &crate::client::rich_commands::RICH_EDIT,
                op.clone(),
            ))],
        ),
        EditorOp::ToggleList { at, kind } => {
            let command = match kind % 3 {
                0 => &lexical_rich_nodes::list::INSERT_ORDERED_LIST,
                1 => &lexical_rich_nodes::list::INSERT_UNORDERED_LIST,
                _ => &lexical_rich_nodes::list::INSERT_CHECK_LIST,
            };
            (
                *at,
                *at,
                vec![Command::Extension(ExtensionCommand::new(command, ()))],
            )
        }
        EditorOp::Type { at, text } => (*at, *at, vec![Command::InsertText(text.clone())]),
        EditorOp::Backspace { at, count } => (
            *at,
            *at,
            (0..*count)
                .map(|_| Command::DeleteCharacter {
                    direction: EditDirection::Backward,
                    target: ModifyTarget::ModelSegmentation,
                })
                .collect(),
        ),
        EditorOp::DeleteRange { from, to } => (*from, *to, vec![Command::RemoveText]),
        EditorOp::SplitBlock { at } => (*at, *at, vec![Command::InsertParagraph]),
        EditorOp::Format { from, to, format } => (
            *from,
            *to,
            vec![Command::FormatText(match format % 4 {
                0 => TextFormatType::Bold,
                1 => TextFormatType::Italic,
                2 => TextFormatType::Code,
                _ => TextFormatType::Strikethrough,
            })],
        ),
        EditorOp::Indent { at } => (*at, *at, vec![Command::IndentContent]),
        EditorOp::Outdent { at } => (*at, *at, vec![Command::OutdentContent]),
        EditorOp::Select { .. }
        | EditorOp::MarkdownShortcut { .. }
        | EditorOp::Undo
        | EditorOp::Redo => return None,
    };
    let anchor = resolve(state, from)?;
    let focus = resolve(state, to)?;
    let mut inputs = vec![];
    if headless {
        inputs.push(Input::Command {
            command: Command::Extension(ExtensionCommand::new(
                &crate::client::commands::MODEL_SELECTION,
                RangeSelection::new(anchor, focus),
            )),
            selection: ViewSelection::KeepModel,
        });
    }
    for (index, command) in commands.into_iter().enumerate() {
        inputs.push(Input::Command {
            command,
            selection: if headless || index > 0 {
                ViewSelection::KeepModel
            } else {
                ViewSelection::Range {
                    anchor,
                    focus,
                    resolution_dirty: false,
                }
            },
        });
    }
    Some(Input::Batch(inputs))
}
