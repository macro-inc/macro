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
    _b: u32,
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
        9 => Command::FormatElement(match a {
            0 => ElementFormat::Unset,
            1 => ElementFormat::Left,
            2 => ElementFormat::Center,
            3 => ElementFormat::Right,
            4 => ElementFormat::Justify,
            5 => ElementFormat::Start,
            6 => ElementFormat::End,
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
        18 => Command::Click,
        _ => return Err(BoundaryError::Invalid("command")),
    })
}
fn modify(msg: wire::ModifyTargetMsg, generation: u32) -> Result<ModifyTarget, BoundaryError> {
    Ok(match msg.kind {
        0 => ModifyTarget::NoView,
        1 => ModifyTarget::View {
            anchor: point(&msg.anchor, generation)?,
            focus: point(&msg.focus, generation)?,
            resolution_dirty: msg.dirty,
            is_backward_in_dom: msg.backward,
        },
        _ => return Err(BoundaryError::Invalid("modify target")),
    })
}
fn range(msg: wire::RangeSelectionMsg, generation: u32) -> Result<RangeSelection, BoundaryError> {
    let mut range = RangeSelection::new(
        point(&msg.anchor, generation)?,
        point(&msg.focus, generation)?,
    );
    range.format =
        TextFormat::from_bits(msg.format).ok_or(BoundaryError::Invalid("selection format"))?;
    range.style = msg.style.into();
    Ok(range)
}
pub(crate) fn input(msg: wire::EditorInputMsg, generation: u32) -> Result<Input, BoundaryError> {
    Ok(match msg {
        wire::EditorInputMsg::EditorCommand {
            command: code,
            a,
            b,
            text,
            selection: s,
            target,
            character_target,
        } => {
            let command = command(code as u32, a, b, Some(text))?;
            let target = modify(target, generation)?;
            let character_target = modify(character_target, generation)?;
            let command = match command {
                Command::DeleteCharacter { direction, .. } => {
                    Command::DeleteCharacter { direction, target }
                }
                Command::DeleteWord { direction, .. } => Command::DeleteWord {
                    direction,
                    target,
                    character_target,
                },
                Command::DeleteLine { direction, .. } => Command::DeleteLine {
                    direction,
                    target,
                    character_target,
                },
                other => other,
            };
            let selection = selection(&s, generation)?;
            match b {
                0 => Input::Command { command, selection },
                1 => Input::Batch(vec![
                    Input::Composition {
                        event: CompositionEvent::Clear,
                        selection,
                    },
                    Input::Command {
                        command,
                        selection: ViewSelection::KeepModel,
                    },
                ]),
                _ => return Err(BoundaryError::Invalid("command composition flags")),
            }
        }
        wire::EditorInputMsg::EditorKeyDown {
            code,
            mods,
            key: name,
            command: c,
            argument,
            selection: s,
            target,
            character_target,
        } => {
            if mods > 63 {
                return Err(BoundaryError::Invalid("targeted key flags"));
            }
            let target = modify(target, generation)?;
            let character_target = modify(character_target, generation)?;
            if matches!(
                c,
                wire::CommandCode::DeleteCharacter
                    | wire::CommandCode::DeleteWord
                    | wire::CommandCode::DeleteLine
            ) && argument > 1
            {
                return Err(BoundaryError::Invalid("key direction"));
            }
            let routed = match c {
                wire::CommandCode::FormatText => command(c as u32, argument, 0, None)?,
                wire::CommandCode::DeleteCharacter => Command::DeleteCharacter {
                    direction: if argument == 0 {
                        EditDirection::Backward
                    } else {
                        EditDirection::Forward
                    },
                    target,
                },
                wire::CommandCode::DeleteWord => Command::DeleteWord {
                    direction: if argument == 0 {
                        EditDirection::Backward
                    } else {
                        EditDirection::Forward
                    },
                    target,
                    character_target,
                },
                wire::CommandCode::DeleteLine => Command::DeleteLine {
                    direction: if argument == 0 {
                        EditDirection::Backward
                    } else {
                        EditDirection::Forward
                    },
                    target,
                    character_target,
                },
                _ => return Err(BoundaryError::Invalid("targeted key command")),
            };
            Input::KeyDown {
                event: KeyEvent {
                    key: name.into(),
                    code: code.to_string().into(),
                    shift: mods & 1 != 0,
                    alt: mods & 2 != 0,
                    ctrl: mods & 4 != 0,
                    meta: mods & 8 != 0,
                    repeat: mods & 16 != 0,
                    is_composing: mods & 32 != 0,
                },
                routed: Some(routed),
                routed_prevent_default: true,
                selection: selection(&s, generation)?,
            }
        }
        wire::EditorInputMsg::EditorApplication {
            name,
            json,
            generation: submitted,
            selection: s,
            keyboard,
            key: logical,
            mods,
            code,
        } => {
            if submitted != generation {
                return Err(BoundaryError::Invalid("application command generation"));
            }
            if mods > 63 {
                return Err(BoundaryError::Invalid("application key flags"));
            }
            let event = keyboard.then(|| KeyEvent {
                key: logical.into(),
                code: code.to_string().into(),
                shift: mods & 1 != 0,
                alt: mods & 2 != 0,
                ctrl: mods & 4 != 0,
                meta: mods & 8 != 0,
                repeat: mods & 16 != 0,
                is_composing: mods & 32 != 0,
            });
            // The application surface owns its append-only group decoder registration.
            let command = macro_document_model::surface::decode_command(
                &name,
                &json,
                generation,
                event.as_ref(),
            )?
            .ok_or(BoundaryError::Invalid("application command name"))?;
            let selection = selection(&s, generation)?;
            if let Some(event) = event {
                Input::KeyDown {
                    event,
                    routed: Some(command),
                    routed_prevent_default: macro_document_model::surface::key_prevents_default(
                        &name,
                    ),
                    selection,
                }
            } else {
                Input::Command { command, selection }
            }
        }
        wire::EditorInputMsg::EditorSetState { json } => Input::SetState {
            state: serde_json::from_str(&json)?,
            tags: TagSet::default(),
        },
        wire::EditorInputMsg::EditorSelection {
            selection: s,
            change,
        } => Input::SelectionFromView {
            selection: selection(&s, generation)?,
            change: Some(SelectionChangeContext {
                triple_click: change.triple_click.unwrap_or(false),
                dom_range_same_node: change.dom_range_same_node.unwrap_or(false),
                dom_anchor_offset: change.dom_anchor_offset.unwrap_or(0),
                dom_focus_offset: change.dom_focus_offset.unwrap_or(0),
                marked: change
                    .marked
                    .map(|m| {
                        Ok::<_, BoundaryError>(MarkedSelectionFormat {
                            format: TextFormat::from_bits(m.format)
                                .ok_or(BoundaryError::Invalid("marked format"))?,
                            style: m.style.into(),
                            key: key(m.anchor.key, generation),
                            offset: m.anchor.offset,
                        })
                    })
                    .transpose()?,
                post_delete_restore: change
                    .post_delete_restore
                    .map(|m| range(m, generation))
                    .transpose()?,
            }),
        },
        wire::EditorInputMsg::EditorPaste {
            selection: s,
            clipboard,
            has_files,
            html_nodes,
        } => Input::Command {
            command: Command::Paste(ClipboardPayload {
                data: clipboard.into_iter().map(|v| (v.mime, v.value)).collect(),
                has_files,
                html_nodes: if html_nodes.is_empty() {
                    None
                } else {
                    Some(
                        html_nodes
                            .into_iter()
                            .map(|v| serde_json::from_str(&v))
                            .collect::<Result<_, _>>()?,
                    )
                },
            }),
            selection: selection(&s, generation)?,
        },
        wire::EditorInputMsg::EditorInsertText {
            phase,
            has_data,
            data,
            has_transfer,
            transfer,
            facts,
            last_key,
            selection: s,
        } => Input::InsertTextEvent {
            phase: match phase {
                0 => TextEventPhase::BeforeInput,
                1 => TextEventPhase::Input,
                _ => return Err(BoundaryError::Invalid("text event phase")),
            },
            data: has_data.then_some(data),
            data_transfer_text: has_transfer.then_some(transfer),
            facts: InsertTextFacts {
                dangling_input: facts & 1 != 0,
                dom_anchor_not_backing_text: facts & 2 != 0,
                target_range_mismatch: facts & 4 != 0,
            },
            last_key: (!last_key.is_empty()).then(|| last_key.into()),
            selection: selection(&s, generation)?,
        },
        wire::EditorInputMsg::EditorComposition {
            kind,
            key: index,
            text,
            anchor_offset,
            focus_offset,
            data,
            selection: s,
        } => Input::Composition {
            event: match kind {
                0 => CompositionEvent::Start { data },
                1 => CompositionEvent::End {
                    key: key(index, generation),
                    text,
                    anchor: (anchor_offset != u32::MAX).then_some(Utf16Offset(anchor_offset)),
                    focus: (focus_offset != u32::MAX).then_some(Utf16Offset(focus_offset)),
                    data,
                },
                2 => CompositionEvent::Clear,
                _ => return Err(BoundaryError::Invalid("composition kind")),
            },
            selection: selection(&s, generation)?,
        },
        wire::EditorInputMsg::EditorText {
            key: index,
            text,
            anchor_offset,
            focus_offset,
            composition_end,
            composition_data,
            selection: s,
        } => Input::TextFromView {
            key: key(index, generation),
            text: String::from_utf16(&text).map_err(|_| BoundaryError::Invalid("LoneSurrogate"))?,
            anchor: (anchor_offset != u32::MAX).then_some(Utf16Offset(anchor_offset)),
            focus: (focus_offset != u32::MAX).then_some(Utf16Offset(focus_offset)),
            composition_end,
            composition_data: (!composition_data.is_empty()).then_some(composition_data),
            selection: selection(&s, generation)?,
        },
        wire::EditorInputMsg::Unknown => return Err(BoundaryError::Invalid("editor input")),
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
