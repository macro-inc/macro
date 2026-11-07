use super::*;
use crate::command::Position;
use lexical_rich_nodes::code::indent::{TabAction, handle_multiline_indent};
#[derive(Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub(super) enum Input {
    Core {
        command: crate::command::Command,
        #[serde(default)]
        shortcuts: bool,
    },
    Delete {
        backward: bool,
        unit: GranularityInput,
        target: Option<Position>,
    },
    Block {
        block: String,
    },
    List {
        list: Option<ListType>,
    },
    Indent {
        outdent: bool,
    },
    Check {
        at: Position,
    },
    Link {
        url: Option<String>,
    },
    Mark {
        id: String,
    },
    Unmark {
        at: Position,
    },
    Table {
        rows: u32,
        columns: u32,
    },
    TableSelect {
        anchor: Position,
        focus: Position,
    },
    TableEdit {
        action: String,
        #[serde(default)]
        after: bool,
    },
    TableMerge {
        cells: Vec<Position>,
    },
    TableClear {
        cells: Vec<Position>,
    },
    CodeIndent {
        outdent: bool,
    },
    Paste {
        nodes: Vec<Value>,
    },
    Markdown {
        text: String,
        #[serde(default)]
        preserve: bool,
        #[serde(default)]
        merge: bool,
    },
    ShortcutEnter {
        #[serde(default)]
        shift: bool,
    },
    Undo,
    Redo,
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum GranularityInput {
    Character,
    Word,
    Line,
}
impl Input {
    pub(super) fn apply(
        &self,
        tx: &mut Transaction<'_>,
        transformers: &Transformers,
    ) -> Result<(), BoundaryError> {
        match self {
            Self::Core { command, .. } => command.apply(tx)?,
            Self::Delete {
                backward,
                unit,
                target,
            } => {
                let direction = if *backward {
                    EditDirection::Backward
                } else {
                    EditDirection::Forward
                };
                let target = target
                    .as_ref()
                    .map(|p| {
                        let r = tx.range_selection()?;
                        let focus = p.point(tx.view())?;
                        let reversed = focus.is_before(tx.view(), &r.anchor)?;
                        let (anchor, focus) = if reversed {
                            (focus, r.anchor)
                        } else {
                            (r.anchor, focus)
                        };
                        Ok::<_, Error>(ModifyTarget::View {
                            anchor,
                            focus,
                            resolution_dirty: false,
                            is_backward_in_dom: reversed,
                        })
                    })
                    .transpose()?
                    .unwrap_or(ModifyTarget::NoView);
                match unit {
                    GranularityInput::Character => tx.delete_character(direction, target)?,
                    GranularityInput::Word => tx.delete_word(direction, target.clone(), target)?,
                    GranularityInput::Line => tx.delete_line(direction, target.clone(), target)?,
                }
            }
            Self::Block { block } => {
                let selection = tx.selection().cloned();
                lexical_rich_nodes::selection::set_blocks_type_default(
                    tx,
                    selection.as_ref(),
                    |tx| {
                        Ok(match block.as_str() {
                            "paragraph" => tx.create(Paragraph::default())?.key(),
                            "quote" => tx.create(QuoteNode::default())?.key(),
                            "code" => tx.create(CodeNode::default())?.key(),
                            tag => tx
                                .create(HeadingNode {
                                    tag: serde_json::from_value(json!(tag))?,
                                })?
                                .key(),
                        })
                    },
                )?;
            }
            Self::List { list } => {
                if let Some(list) = list {
                    format::insert_list(tx, *list)?;
                } else {
                    format::remove_list(tx)?;
                }
            }
            Self::Indent { outdent } => {
                if *outdent {
                    lexical_rich_nodes::rich_text::outdent_content(tx)?;
                } else {
                    lexical_rich_nodes::rich_text::indent_content(tx)?;
                }
            }
            Self::Check { at } => {
                let key = at.point(tx.view())?.key();
                let item = tx
                    .cast::<ListItemNode>(key)
                    .ok_or(Error::NodeTypeMismatch(key))?;
                item::toggle_checked(tx, item)?;
            }
            Self::Link { url } => toggle::toggle_link(tx, url.as_deref(), Default::default())?,
            Self::Mark { id } => {
                let range = tx.range_selection()?.clone();
                let backward = range.is_backward(tx.view())?;
                wrap_selection_in_mark_node(
                    tx,
                    &range,
                    backward,
                    id,
                    None::<fn(&mut Transaction<'_>, Vec<String>) -> Result<NodeKey, Error>>,
                )?;
            }
            Self::Unmark { at } => unwrap_mark_node(tx, at.point(tx.view())?.key())?,
            Self::Table { rows, columns } => {
                let table = create_table_node_with_dimensions(
                    tx,
                    *rows,
                    *columns,
                    IncludeHeaders::All(true),
                )?;
                lexical_rich_nodes::utils::insert_node_to_nearest_root(tx, table.key())?;
            }
            Self::TableSelect { anchor, focus } => {
                let a = anchor.point(tx.view())?.key();
                let f = focus.point(tx.view())?.key();
                let table = get_table_node_from_lexical_node(tx.view(), a)?;
                tx.set_selection(Some(Selection::Table(TableSelection::new(
                    table.key(),
                    a,
                    f,
                ))))?;
            }
            Self::TableEdit { action, after } => match action.as_str() {
                "row" => {
                    insert_table_row_at_selection(tx, *after)?;
                }
                "column" => {
                    insert_table_column_at_selection(tx, *after)?;
                }
                "deleteRow" => delete_table_row_at_selection(tx)?,
                "deleteColumn" => delete_table_column_at_selection(tx)?,
                "unmerge" => unmerge_cell(tx)?,
                _ => return Err(Error::Invariant("unknown table operation").into()),
            },
            Self::TableMerge { cells } => {
                let cells = cells
                    .iter()
                    .map(|p| {
                        let key = p.point(tx.view())?.key();
                        tx.cast::<TableCellNode>(key)
                            .ok_or(Error::NodeTypeMismatch(key))
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                merge_cells(tx, &cells)?;
            }
            Self::TableClear { cells } => {
                for cell in cells {
                    let key = cell.point(tx.view())?.key();
                    tx.clear(key)?;
                    let p = tx.create(Paragraph::default())?;
                    tx.append(key, &[p.key()])?;
                }
            }
            Self::CodeIndent { outdent } => {
                handle_multiline_indent(
                    tx,
                    if *outdent {
                        TabAction::Outdent
                    } else {
                        TabAction::Indent
                    },
                    Default::default(),
                )?;
            }
            Self::Paste { nodes } => {
                let nodes =
                    lexical_rich_nodes::clipboard::generate_nodes_from_serialized_nodes(tx, nodes)?;
                lexical_rich_nodes::clipboard::insert_generated_nodes(
                    tx,
                    &nodes,
                    SelectionSlot::Active,
                )?;
            }
            Self::Markdown {
                text,
                preserve,
                merge,
            } => convert_from_markdown_string(
                tx,
                text,
                transformers,
                None,
                &MarkdownOptions {
                    should_preserve_new_lines: *preserve,
                    should_merge_adjacent_lines: *merge,
                    ..Default::default()
                },
            )?,
            Self::ShortcutEnter { shift } => {
                markdown_shortcuts_on_enter(tx, *shift, transformers, &MarkdownOptions::default())?;
            }
            Self::Undo | Self::Redo => {
                return Err(Error::Invariant("history requires editor boundary").into());
            }
        }
        Ok(())
    }
}
