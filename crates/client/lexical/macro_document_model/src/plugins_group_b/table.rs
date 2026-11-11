//! Application table integrity, list-first Tab, row growth and scoped select-all.
use super::*;
mod actions;
mod controls;
pub mod input;
mod keys;
pub(super) use keys::decode as decode_key;
mod facts;
mod resize;
pub(super) fn query(
    name: &str,
    data: &serde_json::Value,
    generation: u32,
    state: &EditorState,
) -> Result<Option<serde_json::Value>, Error> {
    if let Some(reply) = facts::query(name, data, generation, state)? {
        return Ok(Some(reply));
    }
    resize::query(name, data, generation, state)
}
mod list_grid;
pub(super) use actions::decode;
pub(super) fn event_payload(event: &PluginEvent) -> Result<Option<serde_json::Value>, Error> {
    if let Some(payload) = keys::event_payload(event)? {
        return Ok(Some(payload));
    }
    actions::event_payload(event)
}
use lexical_rich_nodes::{list::ListItemNode, table::*};

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    let builder = actions::register(builder)
        .node_trait::<TableNode, dyn CanSelectBefore>(|node| node)
        .table_selection_hooks(TableSelectionHooksImpl)
        .transform::<TableNode>(transforms::table_transform)
        .transform::<TableRowNode>(transforms::table_row_transform)
        .transform::<TableCellNode>(transforms::table_cell_transform)
        .transform::<TableCellNode>(|tx, cell| {
            for child in tx.children_keys(cell)? {
                if matches!(
                    tx.type_name(child)?,
                    "paragraph"
                        | "heading"
                        | "list"
                        | "task-list"
                        | "quote"
                        | "code"
                        | "custom-code"
                        | "image"
                        | "video"
                ) {
                    continue;
                }
                if tx.is_inline(child) {
                    let p = tx.create(Paragraph::default())?;
                    tx.replace(child, p, false)?;
                    tx.append(p, &[child])?;
                } else {
                    tx.remove(child, false)?;
                }
            }
            Ok(())
        })
        .plugin(Tables);
    keys::register(resize::register(builder))
}
struct Tables;
impl Plugin for Tables {
    fn name(&self) -> &'static str {
        "group-b.tables"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[
            CommandRegistration {
                command: CommandKind::Key(KeyCommand::Tab),
                priority: CommandPriority::Critical,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::SelectAll,
                priority: CommandPriority::High,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::DeleteCharacter,
                priority: CommandPriority::Critical,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::DeleteWord,
                priority: CommandPriority::Critical,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::DeleteLine,
                priority: CommandPriority::Critical,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::InsertClipboardNodes,
                priority: CommandPriority::Critical,
                placement: Placement::After,
            },
        ]
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        if let Command::InsertClipboardNodes { nodes, selection } = command {
            return Ok(
                if insert_clipboard_nodes_in_table(tx, nodes, *selection, false)? {
                    Handled::Yes
                } else {
                    Handled::No
                },
            );
        }
        if let Command::SelectAll(_) = command {
            return select_all(tx);
        }
        let Some(selection) = tx.selection().cloned() else {
            return Ok(Handled::No);
        };
        let anchor = match &selection {
            Selection::Range(range) => range.anchor.key(),
            Selection::Table(table) => table.anchor.key(),
            _ => return Ok(Handled::No),
        };
        let Some(table) = find_table_node(tx.view(), anchor) else {
            return Ok(Handled::No);
        };
        match command {
            Command::Key {
                command: KeyCommand::Tab,
                event,
            } => tab(tx, table, event.as_ref().is_some_and(|e| e.shift)),
            Command::DeleteCharacter { .. }
            | Command::DeleteWord { .. }
            | Command::DeleteLine { .. } => {
                let kind = match command {
                    Command::DeleteWord { .. } => DeleteTextKind::Word,
                    Command::DeleteLine { .. } => DeleteTextKind::Line,
                    _ => DeleteTextKind::Character,
                };
                Ok(
                    if delete_text_in_table(tx, table, kind)? == DeleteOutcome::NotHandled {
                        Handled::No
                    } else {
                        Handled::Yes
                    },
                )
            }
            _ => Ok(Handled::No),
        }
    }
}
fn tab(tx: &mut Transaction<'_>, table: Id<TableNode>, shift: bool) -> Result<Handled, Error> {
    let Some(_) = tx
        .selection()
        .and_then(Selection::as_range)
        .filter(|r| r.is_collapsed())
    else {
        return Ok(Handled::No);
    };
    if input::handle_list_tab(tx, shift)? == Handled::Yes
        || input::handle_insert_row_tab(tx, shift)? == Handled::Yes
    {
        return Ok(Handled::Yes);
    }
    Ok(if tab_in_table(tx, table, shift)? {
        Handled::Yes
    } else {
        Handled::No
    })
}
fn select_all(tx: &mut Transaction<'_>) -> Result<Handled, Error> {
    let Some(selection) = tx.selection().cloned() else {
        return Ok(Handled::No);
    };
    let table = match &selection {
        Selection::Range(range) => find_table_node(tx.view(), range.anchor.key()),
        Selection::Table(selection) => tx.view().cast::<TableNode>(selection.table),
        _ => None,
    };
    let Some(table) = table else {
        return Ok(Handled::No);
    };
    let (map, _, _) = compute_table_map_skip_cell_check(tx.view(), table, None, None)?;
    let Some(first) = map
        .rows
        .first()
        .and_then(|row| row.first())
        .and_then(Option::as_ref)
    else {
        return Ok(Handled::No);
    };
    let Some(last) = map
        .rows
        .last()
        .and_then(|row| row.last())
        .and_then(Option::as_ref)
    else {
        return Ok(Handled::No);
    };
    if let Selection::Table(selection) = selection {
        let shape = selection.get_shape(tx.view())?;
        if shape.from_x == 0
            && shape.from_y == 0
            && shape.to_x + 1 == map.column_count()
            && shape.to_y + 1 == map.row_count()
        {
            return Ok(Handled::No);
        }
    }
    let selection = create_table_selection_from(tx, table, first.cell, last.cell)?;
    tx.set_selection(Some(Selection::Table(selection)))?;
    Ok(Handled::Yes)
}
