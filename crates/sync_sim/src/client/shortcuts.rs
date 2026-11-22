//! Browser shortcut insertion through the real package and conditional transactions.
use lexical_markdown::{MarkdownOptions, ShortcutTrigger, Transformer, Transformers};
use lexical_model::*;
use std::sync::LazyLock;

pub(crate) const PATTERNS: [&str; 4] = ["# ", "- ", "> ", "```"];
pub(crate) static SHORTCUT_CHAR: CommandKey<char> = CommandKey::new("sim-shortcut-char");
const TAG: &str = "sim-shortcut-insertion";
static TRANSFORMERS: LazyLock<Transformers> = LazyLock::new(|| {
    let names = macro_document_model::transformers::list_names("all").expect("source list");
    Transformers::new(
        names
            .iter()
            .filter(|name| !macro_document_model::transformers::is_conversion_only(name))
            .map(|name| {
                macro_document_model::transformers::transformer(name, &Default::default())
                    .expect("source transformer")
            })
            .filter(|transformer| {
                let dependencies = match transformer {
                    Transformer::Element(t) => t.dependencies(),
                    Transformer::MultilineElement(t) => t.dependencies(),
                    _ => return true,
                };
                dependencies.iter().all(|dep| {
                    ["paragraph", "text", "linebreak", "tab"].contains(dep)
                        || macro_document_model::supported_node_types().any(|name| name == *dep)
                })
            }),
    )
});
pub(crate) struct Shortcuts;
impl Plugin for Shortcuts {
    fn name(&self) -> &'static str {
        "sim-browser-shortcuts"
    }
    fn commands(&self) -> &[CommandRegistration] {
        static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
            command: CommandKind::Extension(&SHORTCUT_CHAR),
            priority: CommandPriority::Editor,
            placement: Placement::After,
        }];
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(character) = command.payload(&SHORTCUT_CHAR) else {
            return Ok(Handled::No);
        };
        tx.add_tag(UpdateTag::Custom(TAG.into()));
        tx.insert_text(&character.to_string())?;
        Ok(Handled::Yes)
    }
    fn conditional_after_commit<'a>(&'a self, commit: &'a Commit) -> Option<ConditionalUpdate<'a>> {
        if !commit
            .tags
            .iter()
            .any(|tag| matches!(tag, UpdateTag::Custom(value) if value.as_ref() == TAG))
        {
            return None;
        }
        let trigger = ShortcutTrigger::from_commit(commit, false);
        lexical_markdown::markdown_shortcut_anchor(&commit.next, &trigger, &TRANSFORMERS)?;
        Some(Box::new(move |tx| {
            let applied = lexical_markdown::markdown_shortcuts(
                tx,
                &trigger,
                &TRANSFORMERS,
                &MarkdownOptions {
                    list_indent: 2,
                    ..Default::default()
                },
            )
            .map_err(|error| Error::Extension(Box::new(error)))?;
            if applied {
                tx.add_tag(UpdateTag::HistoryPush);
            }
            Ok(applied)
        }))
    }
}
