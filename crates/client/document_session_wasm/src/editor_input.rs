use crate::*;
use lexical_model::*;
pub(crate) fn key(index: u32, generation: u32) -> NodeKey {
    NodeKey::from_parts(KeyParts { generation, index })
}
pub(crate) fn point(p: &wire::PointMsg, generation: u32) -> Result<Point, BoundaryError> {
    Ok(match p._type {
        0 => Point::text(key(p.key, generation), Utf16Offset(p.offset)),
        1 => Point::element(key(p.key, generation), ChildIndex(p.offset)),
        _ => return Err(BoundaryError::Invalid("point kind")),
    })
}
pub(crate) fn selection(
    s: &wire::SelectionMsg,
    generation: u32,
) -> Result<ViewSelection, BoundaryError> {
    Ok(match s.kind {
        0 => ViewSelection::KeepModel,
        1 => ViewSelection::None,
        2 => ViewSelection::Range {
            anchor: point(&s.anchor, generation)?,
            focus: point(&s.focus, generation)?,
            resolution_dirty: s.dirty,
        },
        3 => ViewSelection::Node(s.nodes.iter().map(|i| key(*i, generation)).collect()),
        4 => ViewSelection::Table {
            table: key(s.table, generation),
            anchor_cell: key(s.anchor.key, generation),
            focus_cell: key(s.focus.key, generation),
        },
        _ => return Err(BoundaryError::Invalid("selection")),
    })
}
pub(crate) fn command(
    code: u32,
    a: u32,
    b: u32,
    text: Option<String>,
) -> Result<Command, BoundaryError> {
    let direction = if a == 0 {
        EditDirection::Backward
    } else {
        EditDirection::Forward
    };
    Ok(match code {
        1 => Command::InsertText(text.ok_or(BoundaryError::Invalid("text"))?),
        2 => Command::RemoveText,
        3 => Command::InsertParagraph,
        4 => Command::InsertLineBreak {
            select_start: a != 0,
        },
        5 => Command::InsertTab,
        6 => Command::IndentContent,
        7 => Command::OutdentContent,
        8 => Command::FormatText(match a {
            0 => TextFormatType::Bold,
            1 => TextFormatType::Italic,
            2 => TextFormatType::Strikethrough,
            3 => TextFormatType::Underline,
            4 => TextFormatType::Code,
            5 => TextFormatType::Subscript,
            6 => TextFormatType::Superscript,
            7 => TextFormatType::Highlight,
            8 => TextFormatType::Lowercase,
            9 => TextFormatType::Uppercase,
            10 => TextFormatType::Capitalize,
            _ => return Err(BoundaryError::Invalid("text format")),
        }),
        9 => Command::FormatElement(match b {
            0 => ElementFormat::Unset,
            1 => ElementFormat::Left,
            2 => ElementFormat::Start,
            3 => ElementFormat::Center,
            4 => ElementFormat::Right,
            5 => ElementFormat::End,
            6 => ElementFormat::Justify,
            _ => return Err(BoundaryError::Invalid("element format")),
        }),
        10 => Command::SelectAll(None),
        11 => Command::ClearEditor,
        12 => Command::ClearHistory,
        13 => Command::Undo,
        14 => Command::Redo,
        15 => Command::DeleteCharacter {
            direction,
            target: ModifyTarget::NoView,
        },
        16 => Command::DeleteWord {
            direction,
            target: ModifyTarget::NoView,
            character_target: ModifyTarget::NoView,
        },
        17 => Command::DeleteLine {
            direction,
            target: ModifyTarget::NoView,
            character_target: ModifyTarget::NoView,
        },
        _ => return Err(BoundaryError::Invalid("command")),
    })
}
pub(crate) fn input(msg: wire::EditorInputMsg, generation: u32) -> Result<Input, BoundaryError> {
    let selection = selection(&msg.selection, generation)?;
    Ok(match msg.kind {
        0 => Input::Command {
            command: command(msg.command as u32, msg.a, msg.b, Some(msg.text))?,
            selection,
        },
        1 => Input::SetState {
            state: serde_json::from_str(&msg.text)?,
            tags: TagSet::default(),
        },
        2 => Input::SelectionFromView {
            selection,
            change: Some(SelectionChangeContext {
                triple_click: msg.triple_click,
                ..SelectionChangeContext::default()
            }),
        },
        3 => Input::Command {
            command: Command::Paste(ClipboardPayload {
                data: msg
                    .clipboard
                    .into_iter()
                    .map(|entry| (entry.mime, entry.value))
                    .collect(),
                has_files: msg.a != 0,
                html_nodes: if msg.html_nodes.is_empty() {
                    None
                } else {
                    Some(
                        msg.html_nodes
                            .into_iter()
                            .map(|v| serde_json::from_str(&v))
                            .collect::<Result<_, _>>()?,
                    )
                },
            }),
            selection,
        },
        _ => return Err(BoundaryError::Invalid("editor input")),
    })
}
pub(crate) fn empty_selection() -> wire::SelectionMsg {
    wire::SelectionMsg {
        kind: 0,
        anchor: wire::PointMsg {
            key: 0,
            offset: 0,
            _type: 0,
        },
        focus: wire::PointMsg {
            key: 0,
            offset: 0,
            _type: 0,
        },
        nodes: vec![],
        table: 0,
        dirty: false,
    }
}
pub(crate) fn view_selection(value: &ViewSelection) -> wire::SelectionMsg {
    let mut s = empty_selection();
    let p = |p: Point| wire::PointMsg {
        key: p.key().index(),
        offset: p.offset(),
        _type: if matches!(p, Point::Text { .. }) {
            0
        } else {
            1
        },
    };
    match value {
        ViewSelection::KeepModel => {}
        ViewSelection::None => s.kind = 1,
        ViewSelection::Range {
            anchor,
            focus,
            resolution_dirty,
        } => {
            s.kind = 2;
            s.anchor = p(*anchor);
            s.focus = p(*focus);
            s.dirty = *resolution_dirty;
        }
        ViewSelection::Node(keys) => {
            s.kind = 3;
            s.nodes = keys.iter().map(|k| k.index()).collect();
        }
        ViewSelection::Table {
            table,
            anchor_cell,
            focus_cell,
        } => {
            s.kind = 4;
            s.table = table.index();
            s.anchor.key = anchor_cell.index();
            s.focus.key = focus_cell.index();
        }
    }
    s
}
