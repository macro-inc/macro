//! Table keyboard policy over one batch of view-owned layout facts.
use super::*;

#[derive(Clone, Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Facts {
    #[serde(default)]
    typeahead: bool,
    #[serde(default)]
    cells: Vec<u32>,
    caret: Option<Caret>,
}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Caret {
    key: u32,
    offset: u32,
    edge: u32,
    up: bool,
    exits: bool,
}
impl TableView for Facts {
    fn is_typeahead_open(&self) -> bool {
        self.typeahead
    }
    fn has_cell_element(&self, key: NodeKey) -> bool {
        self.cells.contains(&key.index())
    }
    fn caret_exits_cell(&self, anchor: &Point, edge: NodeKey, dir: TableDirection) -> Option<bool> {
        self.caret
            .as_ref()
            .filter(|caret| {
                caret.key == anchor.key().index()
                    && caret.offset == anchor.offset()
                    && caret.edge == edge.index()
                    && caret.up == (dir == TableDirection::Up)
            })
            .map(|caret| caret.exits)
    }
}
#[derive(Clone, Debug)]
struct KeyInput {
    facts: Facts,
    event: KeyEvent,
}
#[derive(Clone, Default)]
struct Pending(Facts);
static KEY: CommandKey<KeyInput> = CommandKey::new("group-b.table-key");
static CHECK: CommandKey<Vec<NodeKey>> = CommandKey::new("group-b.table-check-down");
#[derive(Clone, Debug, serde::Serialize)]
struct CheckDown {
    tables: Vec<u32>,
    generation: u32,
}
static CHECK_DOWN: EventKey<CheckDown> = EventKey::new("group-b.table-check-down");

pub(in crate::plugins_group_b) fn decode(
    name: &str,
    json: &str,
    generation: u32,
    event: Option<&KeyEvent>,
) -> Result<Option<Command>, Error> {
    if name == KEY.name() {
        return Ok(Some(Command::Extension(ExtensionCommand::new(
            &KEY,
            KeyInput {
                facts: serde_json::from_str(json)?,
                event: event
                    .ok_or(Error::Invariant("table keyboard facts"))?
                    .clone(),
            },
        ))));
    }
    if name == CHECK.name() {
        #[derive(serde::Deserialize)]
        struct Request {
            tables: Vec<u32>,
        }
        let request: Request = serde_json::from_str(json)?;
        return Ok(Some(Command::Extension(ExtensionCommand::new(
            &CHECK,
            request
                .tables
                .into_iter()
                .map(|index| NodeKey::from_parts(KeyParts { index, generation }))
                .collect(),
        ))));
    }
    Ok(None)
}
pub(super) fn event_payload(event: &PluginEvent) -> Result<Option<serde_json::Value>, Error> {
    event
        .payload(&CHECK_DOWN)
        .map(serde_json::to_value)
        .transpose()
        .map_err(Into::into)
}
pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.extension_state(Pending::default()).plugin(Keys)
}
static COMMANDS: [CommandRegistration; 8] = [
    CommandRegistration {
        command: CommandKind::Extension(&KEY),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Extension(&CHECK),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Key(KeyCommand::ArrowUp),
        priority: CommandPriority::Critical,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Key(KeyCommand::ArrowDown),
        priority: CommandPriority::Critical,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Key(KeyCommand::ArrowLeft),
        priority: CommandPriority::Critical,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Key(KeyCommand::ArrowRight),
        priority: CommandPriority::Critical,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Key(KeyCommand::Escape),
        priority: CommandPriority::High,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::SelectionChange,
        priority: CommandPriority::Critical,
        placement: Placement::After,
    },
];
struct Keys;
impl Plugin for Keys {
    fn name(&self) -> &'static str {
        "group-b.table-keys"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        if let Command::Extension(extension) = command {
            if let Some(input) = extension.payload(&KEY) {
                let key = match input.event.key.as_ref() {
                    "ArrowUp" => KeyCommand::ArrowUp,
                    "ArrowDown" => KeyCommand::ArrowDown,
                    "ArrowLeft" => KeyCommand::ArrowLeft,
                    "ArrowRight" => KeyCommand::ArrowRight,
                    "Escape" => KeyCommand::Escape,
                    _ => return Err(Error::Invariant("table keyboard command")),
                };
                let previous =
                    std::mem::replace(&mut tx.extension_mut::<Pending>()?.0, input.facts.clone());
                let result = tx.dispatch(&Command::Key {
                    command: key,
                    event: Some(input.event.clone()),
                });
                tx.extension_mut::<Pending>()?.0 = previous;
                return result;
            }
            if let Some(keys) = extension.payload(&CHECK) {
                for key in keys {
                    if let Some(table) = tx
                        .view()
                        .cast::<TableNode>(*key)
                        .filter(|_| tx.is_attached(*key))
                        && fix_selection_after_down_into_table(tx, table)?
                    {
                        break;
                    }
                }
                return Ok(Handled::No);
            }
            return Ok(Handled::No);
        }
        if matches!(command, Command::SelectionChange) {
            normalize_table_selection(tx)?;
            if let RangeFix::ConvertToCells {
                table,
                anchor,
                focus,
                ..
            } = fix_range_selection_for_tables(tx, &|_| TouchState::default())?
            {
                let selection = create_table_selection_from(tx, table, anchor, focus)?;
                tx.set_selection(Some(Selection::Table(selection)))?;
            }
            return Ok(Handled::No);
        }
        let Command::Key { command, event } = command else {
            return Ok(Handled::No);
        };
        if *command == KeyCommand::Escape {
            let table = tx.selection().and_then(|selection| match selection {
                Selection::Table(selection) => tx.view().cast::<TableNode>(selection.table),
                _ => None,
            });
            if let Some(table) = table
                && escape_table_selection(tx, table)?
            {
                tx.prevent_default();
                return Ok(Handled::Yes);
            }
            return Ok(Handled::No);
        }
        let dir = match command {
            KeyCommand::ArrowUp => TableDirection::Up,
            KeyCommand::ArrowDown => TableDirection::Down,
            KeyCommand::ArrowLeft => TableDirection::Backward,
            KeyCommand::ArrowRight => TableDirection::Forward,
            _ => return Ok(Handled::No),
        };
        let facts = tx.extension::<Pending>()?.0.clone();
        let tables: Vec<_> = lexical_rich_nodes::utils::dfs(tx.view(), None, None)
            .into_iter()
            .filter_map(|entry| tx.view().cast::<TableNode>(entry.node))
            .collect();
        let mut checks = Vec::new();
        for table in tables {
            let result = handle_arrow_key(
                tx,
                table,
                dir,
                event.as_ref().is_some_and(|event| event.shift),
                &facts,
            )?;
            match result.effect {
                ObserverEffect::SelectCells {
                    table,
                    anchor,
                    focus,
                } => {
                    let selection = create_table_selection_from(tx, table, anchor, focus)?;
                    tx.set_selection(Some(Selection::Table(selection)))?;
                }
                ObserverEffect::ResyncFromTableSelection {
                    anchor,
                    then: Some((a, f)),
                } => {
                    if let Some(table) = find_table_node(tx.view(), anchor.key()) {
                        let selection = create_table_selection_from(tx, table, a, f)?;
                        tx.set_selection(Some(Selection::Table(selection)))?;
                    }
                }
                ObserverEffect::CheckSelectionAfterDown { table } => checks.push(table.key()),
                _ => {}
            }
            if result.stop_event {
                tx.prevent_default();
            }
            if result.handled {
                return Ok(Handled::Yes);
            }
        }
        if let Some(first) = checks.first() {
            tx.emit(
                &CHECK_DOWN,
                CheckDown {
                    generation: first.generation(),
                    tables: checks.iter().map(|key| key.index()).collect(),
                },
            );
        }
        Ok(Handled::No)
    }
}
