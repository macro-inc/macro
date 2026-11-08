//! Code commands and scoped selection; token painting remains exclusively in the view.
use super::*;
mod navigation;
use crate::nodes::{CustomCodeNode, create_custom_code_node, set_custom_code};
use lexical_rich_nodes::code::{CodeNode, indent::*};

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case")]
enum CodeAction {
    Insert { language: String, code: String },
    Language { key: u32, language: String },
    Preview { key: u32, enabled: bool },
    Delete { key: u32 },
}
#[derive(Clone, Debug)]
struct CodeCommand {
    action: CodeAction,
    generation: u32,
}
static CODE: CommandKey<CodeCommand> = CommandKey::new("group-b.code");

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name != CODE.name() {
        return Ok(None);
    }
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &CODE,
        CodeCommand {
            action: serde_json::from_str(json)?,
            generation,
        },
    ))))
}
pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(Code)
}
static COMMANDS: [CommandRegistration; 8] = [
    CommandRegistration {
        command: CommandKind::Key(KeyCommand::ArrowUp),
        priority: CommandPriority::Low,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Key(KeyCommand::ArrowDown),
        priority: CommandPriority::Low,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Extension(&CODE),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::SelectAll,
        priority: CommandPriority::High,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Key(KeyCommand::Tab),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::InsertTab,
        priority: CommandPriority::High,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::IndentContent,
        priority: CommandPriority::High,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::OutdentContent,
        priority: CommandPriority::High,
        placement: Placement::After,
    },
];
struct Code;
impl Plugin for Code {
    fn name(&self) -> &'static str {
        "group-b.code"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let handled = match command {
            Command::Extension(extension) => {
                let Some(command) = extension.payload(&CODE) else {
                    return Ok(Handled::No);
                };
                return apply(tx, command);
            }
            Command::SelectAll(_) => return select_all(tx),
            Command::Key {
                command: KeyCommand::ArrowUp,
                ..
            } => return navigation::arrow(tx, false),
            Command::Key {
                command: KeyCommand::ArrowDown,
                ..
            } => return navigation::arrow(tx, true),
            Command::Key {
                command: KeyCommand::Tab,
                event,
            } => {
                let Some(action) =
                    handle_key_tab(tx.view(), event.as_ref().is_some_and(|e| e.shift))?
                else {
                    return Ok(Handled::No);
                };
                return tx.dispatch(match action {
                    TabAction::InsertTab => &Command::InsertTab,
                    TabAction::Indent => &Command::IndentContent,
                    TabAction::Outdent => &Command::OutdentContent,
                });
            }
            Command::InsertTab => insert_tab_in_code(tx)?,
            Command::IndentContent => {
                handle_multiline_indent(tx, TabAction::Indent, CodeIndentOptions::default())?
            }
            Command::OutdentContent => {
                handle_multiline_indent(tx, TabAction::Outdent, CodeIndentOptions::default())?
            }
            _ => false,
        };
        Ok(if handled { Handled::Yes } else { Handled::No })
    }
}
fn apply(tx: &mut Transaction<'_>, command: &CodeCommand) -> Result<Handled, Error> {
    let key = |index| {
        NodeKey::from_parts(KeyParts {
            index,
            generation: command.generation,
        })
    };
    match &command.action {
        CodeAction::Insert { language, code } => {
            let node = create_custom_code_node(tx, Some(language))?;
            set_custom_code(tx, node, Some(language), code)?;
            tx.insert_nodes(&[node.key()])?;
        }
        CodeAction::Language {
            key: index,
            language,
        } => {
            let key = key(*index);
            if !tx.is_attached(key) || !tx.is::<CodeNode>(key) {
                return Ok(Handled::No);
            }
            if tx.is::<CustomCodeNode>(key) {
                let mut code = tx.get_mut::<CustomCodeNode>(key)?;
                code.code.language = Some(language.clone());
                if !language.eq_ignore_ascii_case("svg") {
                    code.preview_enabled = false;
                }
            } else {
                tx.get_mut::<CodeNode>(key)?.language = Some(language.clone());
            }
        }
        CodeAction::Preview {
            key: index,
            enabled,
        } => {
            let key = key(*index);
            if !tx.is_attached(key) || !tx.is::<CustomCodeNode>(key) {
                return Ok(Handled::No);
            }
            tx.get_mut::<CustomCodeNode>(key)?.preview_enabled = *enabled;
        }
        CodeAction::Delete { key: index } => {
            let key = key(*index);
            if !tx.is_attached(key) || !tx.is::<CodeNode>(key) {
                return Ok(Handled::No);
            }
            super::structure::remove_and_restore_selection(tx, key)?;
        }
    }
    Ok(Handled::Yes)
}
fn select_all(tx: &mut Transaction<'_>) -> Result<Handled, Error> {
    let Some(range) = tx.selection().and_then(Selection::as_range).cloned() else {
        return Ok(Handled::No);
    };
    let code = |key| tx.find_matching_parent(key, |state, key| state.is::<CodeNode>(key));
    let Some(block) = code(range.anchor.key()).filter(|key| Some(*key) == code(range.focus.key()))
    else {
        return Ok(Handled::No);
    };
    if range.text_content(tx.view())? == tx.text_content(block) {
        return Ok(Handled::No);
    }
    let mut range = RangeSelection::collapsed(Point::element(block, ChildIndex(0)));
    range.focus = Point::element(block, ChildIndex(tx.children_size(block)));
    tx.set_selection(Some(Selection::Range(range)))?;
    Ok(Handled::Yes)
}
