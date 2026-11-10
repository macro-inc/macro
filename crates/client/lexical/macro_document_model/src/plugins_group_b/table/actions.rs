//! Typed application table actions independent of DOM controls.
use super::*;
#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(untagged)]
enum Headers {
    All(bool),
    Axes { rows: bool, columns: bool },
}
impl Default for Headers {
    fn default() -> Self {
        Self::All(true)
    }
}
impl Headers {
    fn policy(self) -> IncludeHeaders {
        match self {
            Self::All(value) => IncludeHeaders::All(value),
            Self::Axes { rows, columns } => IncludeHeaders::Some { rows, columns },
        }
    }
}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(
    tag = "action",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
enum TableAction {
    Picker,
    SelectionMerge,
    SelectionSplit,
    ConvertList {
        key: u32,
    },
    Insert {
        rows: u32,
        columns: u32,
        #[serde(default)]
        headers: Headers,
    },
    Delete {
        cell: u32,
        axis: super::controls::Axis,
    },
    InsertRow {
        cell: u32,
        after: bool,
    },
    InsertColumn {
        cell: u32,
        after: bool,
    },
    MoveCells {
        anchor: u32,
        focus: u32,
        target: u32,
    },
    ResizeColumn {
        table: u32,
        column: u32,
        base_widths: Vec<f64>,
        delta: f64,
        #[serde(default)]
        merge: bool,
    },
    ResizeRow {
        row: u32,
        base_height: f64,
        delta: f64,
        #[serde(default)]
        merge: bool,
    },
    RestoreColumns {
        table: u32,
        #[serde(default)]
        widths: ColumnWidths,
    },
    RestoreRow {
        row: u32,
        height: Option<JsNumber>,
    },
}
#[derive(Clone, Debug)]
struct TableCommand {
    action: TableAction,
    generation: u32,
}
static PICKER: EventKey<()> = EventKey::new("group-b.table-picker");
pub(in crate::plugins_group_b) fn event_payload(
    event: &PluginEvent,
) -> Result<Option<serde_json::Value>, Error> {
    Ok(event.payload(&PICKER).map(|_| serde_json::Value::Null))
}
static TABLE: CommandKey<TableCommand> = CommandKey::new("group-b.table");
pub(in crate::plugins_group_b) fn decode(
    name: &str,
    json: &str,
    generation: u32,
) -> Result<Option<Command>, Error> {
    if name != TABLE.name() {
        return Ok(None);
    }
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &TABLE,
        TableCommand {
            action: serde_json::from_str(json)?,
            generation,
        },
    ))))
}
pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(Actions)
}
struct Actions;
static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&TABLE),
    priority: CommandPriority::Editor,
    placement: Placement::After,
}];
impl Plugin for Actions {
    fn name(&self) -> &'static str {
        "group-b.table-actions"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(extension) = command else {
            return Ok(Handled::No);
        };
        let Some(command) = extension.payload(&TABLE) else {
            return Ok(Handled::No);
        };
        let key = |index| {
            NodeKey::from_parts(KeyParts {
                index,
                generation: command.generation,
            })
        };
        let handled = match &command.action {
            TableAction::Picker => {
                if tx.selection().is_none() {
                    return Ok(Handled::No);
                }
                tx.emit(&PICKER, ());
                true
            }
            TableAction::SelectionMerge => {
                let Some(selection) = tx.selection().and_then(Selection::as_table) else {
                    return Ok(Handled::No);
                };
                let cells = selection
                    .get_nodes(tx.view())?
                    .into_iter()
                    .filter_map(|key| tx.view().cast::<TableCellNode>(key))
                    .collect::<Vec<_>>();
                merge_cells(tx, &cells)?;
                tx.set_selection(None)?;
                true
            }
            TableAction::SelectionSplit => {
                unmerge_cell(tx)?;
                tx.set_selection(None)?;
                true
            }
            TableAction::ConvertList { key: index } => super::list_grid::convert(tx, key(*index))?,
            TableAction::Insert {
                rows,
                columns,
                headers,
            } => insert_table(
                tx,
                &InsertTablePayload {
                    rows: *rows,
                    columns: *columns,
                    include_headers: headers.policy(),
                },
                false,
            )?,
            TableAction::Delete { cell, axis } => super::controls::delete(tx, key(*cell), *axis)?,
            TableAction::MoveCells {
                anchor,
                focus,
                target,
            } => super::controls::move_cells(tx, key(*anchor), key(*focus), key(*target))?,
            TableAction::InsertRow { cell, after } => {
                let cell = key(*cell);
                if !tx.is::<TableCellNode>(cell) || !tx.is_attached(cell) {
                    return Ok(Handled::No);
                }
                tx.select_start(cell)?;
                insert_table_row_at_selection(tx, *after)?.is_some()
            }
            TableAction::InsertColumn { cell, after } => {
                let cell = key(*cell);
                if !tx.is::<TableCellNode>(cell) || !tx.is_attached(cell) {
                    return Ok(Handled::No);
                }
                tx.select_start(cell)?;
                insert_table_column_at_selection(tx, *after)?.is_some()
            }
            TableAction::ResizeColumn {
                table,
                column,
                base_widths,
                delta,
                merge,
            } => super::resize::column(tx, key(*table), *column, base_widths, *delta, *merge)?,
            TableAction::ResizeRow {
                row,
                base_height,
                delta,
                merge,
            } => super::resize::row(tx, key(*row), *base_height, *delta, *merge)?,
            TableAction::RestoreColumns { table, widths } => {
                let table = key(*table);
                if !tx.is::<TableNode>(table) || !tx.is_attached(table) {
                    return Ok(Handled::No);
                }
                tx.get_mut::<TableNode>(table)?.col_widths = widths.clone();
                super::resize::tags(tx, true);
                true
            }
            TableAction::RestoreRow { row, height } => {
                let row = key(*row);
                if !tx.is::<TableRowNode>(row) || !tx.is_attached(row) {
                    return Ok(Handled::No);
                }
                tx.get_mut::<TableRowNode>(row)?.height = *height;
                super::resize::tags(tx, true);
                true
            }
        };
        Ok(if handled { Handled::Yes } else { Handled::No })
    }
}
