//! Source Macro Markdown shortcuts after native insertion and before Enter normalization.
use crate::transformers::{self, MacroMarkdownOptions};
use lexical_markdown::{MarkdownOptions, ShortcutTrigger, Transformer, Transformers};
use lexical_model::*;
use std::sync::{Arc, OnceLock};

struct Config {
    typing: Transformers,
    enter: Vec<Transformer>,
}
#[derive(Default)]
struct Shortcuts {
    config: OnceLock<Result<Config, Arc<str>>>,
}
impl Shortcuts {
    fn config(&self, tx: &Transaction<'_>) -> Result<&Config, Error> {
        self.config
            .get_or_init(|| {
                let build = || -> Result<Config, Error> {
                    let options = MacroMarkdownOptions::default();
                    let available = |callback: &Transformer| {
                        let dependencies = match callback {
                            Transformer::Element(callback) => callback.dependencies(),
                            Transformer::MultilineElement(callback) => callback.dependencies(),
                            Transformer::TextMatch(callback) => callback.dependencies(),
                            Transformer::TextFormat(_) => &[],
                        };
                        dependencies
                            .iter()
                            .all(|name| tx.view().has_node_type(name))
                    };
                    let names = transformers::list_names("all")
                        .ok_or(Error::Invariant("Macro shortcut catalog"))?;
                    let mut typing = Vec::new();
                    for name in names {
                        if transformers::is_conversion_only(name) {
                            continue;
                        }
                        let callback =
                            transformers::transformer(name, &options).map_err(|error| {
                                Error::invariant(format!("Markdown shortcut: {error}"))
                            })?;
                        if available(&callback) {
                            typing.push(callback);
                        }
                    }
                    let mut enter = Vec::new();
                    for name in ["HR", "CODE", "ORDERED_LIST_ENTER"] {
                        let callback =
                            transformers::transformer(name, &options).map_err(|error| {
                                Error::invariant(format!("Markdown Enter shortcut: {error}"))
                            })?;
                        if available(&callback) {
                            enter.push(callback);
                        }
                    }
                    Ok(Config {
                        typing: Transformers::new(typing),
                        enter,
                    })
                };
                build().map_err(|error| Arc::from(error.to_string()))
            })
            .as_ref()
            .map_err(|message| Error::invariant(message.to_string()))
    }
}
pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(Shortcuts::default())
}
impl Plugin for Shortcuts {
    fn name(&self) -> &'static str {
        "group-a.markdown-shortcuts"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[CommandRegistration {
            command: CommandKind::Key(KeyCommand::Enter),
            priority: CommandPriority::Normal,
            placement: Placement::Before,
        }]
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        if !matches!(
            command,
            Command::Key {
                command: KeyCommand::Enter,
                ..
            }
        ) {
            return Ok(Handled::No);
        }
        // Macro's listener matches the first paragraph child independently of
        // caret offset, range direction and modifier keys.
        let Some(Selection::Range(range)) = tx.selection() else {
            return Ok(Handled::No);
        };
        let node = range.anchor.key();
        let Some(parent) = tx.parent(node).filter(|parent| tx.is::<Paragraph>(*parent)) else {
            return Ok(Handled::No);
        };
        if tx.first_child(parent) != Some(node) {
            return Ok(Handled::No);
        }
        let text = tx.text_content(node);
        let options = MarkdownOptions {
            list_indent: 2,
            ..Default::default()
        };
        for callback in &self.config(tx)?.enter {
            match callback {
                Transformer::Element(callback) => {
                    let Some(found) = callback.reg_exp().exec(&text) else {
                        continue;
                    };
                    callback
                        .replace(tx, &options, parent, &[node], &found, false)
                        .map_err(|error| {
                            Error::invariant(format!("Markdown Enter shortcut: {error}"))
                        })?;
                }
                Transformer::MultilineElement(callback) => {
                    let Some(found) = callback.reg_exp_start().exec(&text) else {
                        continue;
                    };
                    callback
                        .replace(
                            tx,
                            &options,
                            parent,
                            Some(&[node]),
                            &found,
                            None,
                            None,
                            false,
                        )
                        .map_err(|error| {
                            Error::invariant(format!("Markdown Enter shortcut: {error}"))
                        })?;
                }
                _ => continue,
            }
            tx.remove(node, false)?;
            tx.prevent_default();
            return Ok(Handled::Yes);
        }
        Ok(Handled::No)
    }
    fn isolated_after_commit(&self) -> Option<&dyn IsolatedAfterCommit> {
        Some(self)
    }
}
impl IsolatedAfterCommit for Shortcuts {
    fn apply(&self, tx: &mut Transaction<'_>, commit: &Commit) -> Result<bool, Error> {
        let config = self.config(tx)?;
        let trigger = ShortcutTrigger::from_commit(commit, tx.composition_key().is_some());
        if lexical_markdown::markdown_shortcut_anchor(tx, &trigger, &config.typing).is_none() {
            return Ok(false);
        }
        let changed = lexical_markdown::markdown_shortcuts(
            tx,
            &trigger,
            &config.typing,
            &MarkdownOptions {
                list_indent: 2,
                ..Default::default()
            },
        )
        .map_err(|error| Error::invariant(format!("Markdown shortcut: {error}")))?;
        if changed {
            tx.add_tag(UpdateTag::HistoryPush);
        }
        Ok(changed)
    }
}
