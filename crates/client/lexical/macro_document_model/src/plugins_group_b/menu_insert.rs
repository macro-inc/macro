//! Source menu insertions INSERT_TEXT_COMMAND and INSERT_GROUP_MENTION_COMMAND:
//! `$insertNodes` at the selection, wrap a root-level node in a paragraph, then
//! `selectEnd`. Agent-session and booking-link inserts are owned by
//! decorator_content_actions.
use crate::nodes::{GroupMentionNode, Maybe};
use lexical_model::*;

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct TextInput {
    text: String,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GroupInput {
    group_alias: String,
}

#[derive(Clone, Debug)]
struct Insert<Input> {
    input: Input,
    generation: u32,
}

static TEXT: CommandKey<Insert<TextInput>> = CommandKey::new("group-b.insert-text");
static GROUP: CommandKey<Insert<GroupInput>> = CommandKey::new("group-b.insert-group-mention");

static COMMANDS: [CommandRegistration; 2] = [
    CommandRegistration {
        command: CommandKind::Extension(&TEXT),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Extension(&GROUP),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
];

fn extension<
    Input: serde::de::DeserializeOwned + Clone + std::fmt::Debug + Send + Sync + 'static,
>(
    key: &'static CommandKey<Insert<Input>>,
    json: &str,
    generation: u32,
) -> Result<Option<Command>, Error> {
    Ok(Some(Command::Extension(ExtensionCommand::new(
        key,
        Insert {
            input: serde_json::from_str(json)?,
            generation,
        },
    ))))
}

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name == TEXT.name() {
        extension(&TEXT, json, generation)
    } else if name == GROUP.name() {
        extension(&GROUP, json, generation)
    } else {
        Ok(None)
    }
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(MenuInsertion)
}

fn current<Input>(tx: &Transaction<'_>, command: &Insert<Input>) -> bool {
    command.generation == tx.committed_state().max_key().generation()
}

fn insert_and_wrap(tx: &mut Transaction<'_>, node: NodeKey) -> Result<(), Error> {
    tx.insert_nodes_at_selection(&[node])?;
    let parent = tx.parent_or_err(node)?;
    if tx.is_root_or_shadow_root(parent) {
        lexical_rich_nodes::utils::wrap_node_in_element(tx, node, |tx| {
            Ok(tx.create(Paragraph::default())?.key())
        })?;
    }
    Ok(())
}

fn place(tx: &mut Transaction<'_>, mention: NodeKey) -> Result<Handled, Error> {
    insert_and_wrap(tx, mention)?;
    // Source DecoratorNode.selectEnd is LexicalNode.selectNext(0, 0).
    tx.select_next(mention, Some(Utf16Offset::ZERO), Some(Utf16Offset::ZERO))?;
    Ok(Handled::Yes)
}

struct MenuInsertion;
impl Plugin for MenuInsertion {
    fn name(&self) -> &'static str {
        "group-b.menu-insertion"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(extension) = command else {
            return Ok(Handled::No);
        };
        if let Some(command) = extension.payload(&TEXT) {
            if !current(tx, command) {
                return Ok(Handled::No);
            }
            let text = tx.create_text(&command.input.text)?;
            insert_and_wrap(tx, text.key())?;
            tx.select_end(text)?;
            return Ok(Handled::Yes);
        }
        if let Some(command) = extension.payload(&GROUP) {
            if !current(tx, command) {
                return Ok(Handled::No);
            }
            let mention = tx.create(GroupMentionNode {
                group_alias: Maybe::Value(command.input.group_alias.clone()),
            })?;
            return place(tx, mention.key());
        }
        Ok(Handled::No)
    }
}
