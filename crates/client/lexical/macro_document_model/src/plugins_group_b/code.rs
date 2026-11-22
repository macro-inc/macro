//! Code commands, scoped selection and the view-attached highlighter transform; tokens come from
//! the host tokenizer (code/tokens.rs), painting stays in the view.
use super::*;
mod navigation;
mod normalize;
pub(super) mod tokens;
use crate::nodes::{CustomCodeNode, create_custom_code_node, set_custom_code};
use lexical_rich_nodes::code::{CodeHighlightNode, CodeNode, indent::*};

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
    builder
        .plugin(Code)
        .transform::<CodeNode>(normalize::normalize)
        .transform_each(
            normalize::text,
            TransformScope::Types(&["text", "code-highlight"]),
        )
}
static COMMANDS: [CommandRegistration; 7] = [
    CommandRegistration {
        command: CommandKind::KeyDown,
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
    fn key_down_keys(&self) -> lexical_model::KeyDownKeys {
        lexical_model::KeyDownKeys::Only(&["ArrowUp", "ArrowDown"])
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
            Command::KeyDown(event) if event.key.as_ref() == "ArrowUp" => {
                return navigation::arrow(tx, false);
            }
            Command::KeyDown(event) if event.key.as_ref() == "ArrowDown" => {
                return navigation::arrow(tx, true);
            }
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

/// Source highlighter default (Macro sets `PrismTokenizer.defaultLanguage`).
pub const HIGHLIGHT_DEFAULT_LANGUAGE: &str = "plaintext";

/// One Source `$codeNodeTransform` run, which also sets syntax-highlight support
/// from the host grammar table; the view host owns that table.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub(super) struct CodeHighlight {
    pub(super) key: u32,
    pub(super) generation: u32,
    pub(super) language: Option<String>,
}
pub(super) static CODE_HIGHLIGHT: EventKey<CodeHighlight> = EventKey::new("group-b.code-highlight");

pub(super) fn event_payload(event: &PluginEvent) -> Result<Option<serde_json::Value>, Error> {
    event
        .payload(&CODE_HIGHLIGHT)
        .map(serde_json::to_value)
        .transpose()
        .map_err(Error::from)
}

/// Source `$codeNodeTransform`: a code node whose language is unset receives the
/// tokenizer default through `setLanguage`, including the custom-code preview reset;
/// every run reports the resulting language to the host.
/// Source `nodesCurrentlyHighlighting`: code nodes already tokenized in the pending update. It
/// lives in the transaction's update-local slot, which every publication clears.
#[derive(Default)]
struct Highlighted(std::collections::HashSet<NodeKey>);

fn default_highlight_language(tx: &mut Transaction<'_>, code: Id<CodeNode>) -> Result<(), Error> {
    let Some(language) = tx
        .view()
        .get::<CodeNode>(code)
        .map(|node| node.language().map(str::to_owned))
    else {
        return Ok(());
    };
    let language = match language {
        Some(language) => language,
        None => {
            tx.get_mut::<CodeNode>(code)?
                .set_language(Some(HIGHLIGHT_DEFAULT_LANGUAGE));
            if tx
                .view()
                .get::<CustomCodeNode>(code.key())
                .is_some_and(|node| node.preview_enabled)
            {
                tx.get_mut::<CustomCodeNode>(code.key())?.preview_enabled = false;
            }
            HIGHLIGHT_DEFAULT_LANGUAGE.to_owned()
        }
    };
    // Source order: `isCodeLanguageLoaded` on every pass, then the per-update dedupe; the key is
    // recorded before `$tokenize`, so a failed tokenize is not retried within the update.
    if tx.is_attached(code)
        && tokens::is_loaded(tx, &language)?
        && tx.update_local_mut::<Highlighted>()?.0.insert(code.key())
    {
        let text = tx.text_content(code).into_owned();
        let descriptors = tokens::tokenize(tx, &language, &text)?;
        tokens::apply(tx, code.key(), &descriptors)?;
    }
    tx.emit(
        &CODE_HIGHLIGHT,
        CodeHighlight {
            key: code.key().index(),
            generation: code.key().generation(),
            language: Some(language),
        },
    );
    Ok(())
}

/// Source `$textNodeTransform`: a leaf inside a code node reruns the code transform on its
/// parent (element transforms only run for intentionally dirtied elements, so typing reaches the
/// tokenizer only through this); an orphaned code-highlight becomes plain text.
fn code_leaf(tx: &mut Transaction<'_>, leaf: NodeKey) -> Result<(), Error> {
    if let Some(code) = tx
        .parent(leaf)
        .and_then(|parent| tx.view().cast::<CodeNode>(parent))
    {
        return default_highlight_language(tx, code);
    }
    if tx.is::<CodeHighlightNode>(leaf) {
        let text = tx.text_content(leaf).into_owned();
        let plain = tx.create_text(&text)?;
        tx.replace(leaf, plain, false)?;
    }
    Ok(())
}
fn text_leaf(tx: &mut Transaction<'_>, leaf: Id<Text>) -> Result<(), Error> {
    code_leaf(tx, leaf.key())
}
fn highlight_leaf(tx: &mut Transaction<'_>, leaf: Id<CodeHighlightNode>) -> Result<(), Error> {
    code_leaf(tx, leaf.key())
}

/// Install the Source code-highlighting model effects (`registerCodeHighlighting`: CodeNode,
/// TextNode and CodeHighlightNode transforms). Source registers them only where an editor
/// installs code highlighting, so headless editors leave this out; natively the surface also
/// requires a session code tokenizer (the dormant code-highlighting activation).
///
/// Like Source, each code node is tokenized at most once per pending update
/// (`nodesCurrentlyHighlighting`), so text changed after that pass keeps stale stored tokens until
/// the next update.
pub(super) fn register_highlighting(builder: EditorBuilder) -> EditorBuilder {
    builder
        .transform::<CodeNode>(default_highlight_language)
        .transform::<Text>(text_leaf)
        .transform::<CodeHighlightNode>(highlight_leaf)
}
