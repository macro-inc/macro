//! Structure, list, table, media, clipboard and link model plugins.
use lexical_model::*;

mod checklist;
mod code;
mod diff;
mod keyboard;
mod list_insert;
mod media;
mod metadata;
pub use metadata::{DOCUMENT_METADATA, DOCUMENT_VERSION};
mod structure;
mod table;

/// Surface block conversion supported by the node-transform plugin.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BlockKind {
    /// Plain paragraph.
    Paragraph,
    /// First heading level.
    Heading1,
    /// Second heading level.
    Heading2,
    /// Third heading level.
    Heading3,
    /// Block quote.
    Quote,
    /// Source code block, respecting the preset replacement.
    #[serde(alias = "custom-code")]
    Code,
    /// Inline hyperlink block conversion supported by the source command.
    Link,
    /// Bullet list.
    #[serde(alias = "list-bullet")]
    Bullet,
    /// Numbered list.
    #[serde(alias = "list-number")]
    Number,
    /// Checklist.
    #[serde(alias = "list-check")]
    Check,
}
/// Convert the active forward-normalized range without changing its direction.
pub static NODE_TRANSFORM: CommandKey<BlockKind> = CommandKey::new("group-b.node-transform");

/// Register Group B policy for a surface; registry-only editors stay unchanged.
pub fn register(builder: EditorBuilder, ty: crate::EditorType) -> EditorBuilder {
    if ty == crate::EditorType::Title {
        return structure::single_line(builder);
    }
    if ty == crate::EditorType::PlainText {
        return builder;
    }
    let builder = lexical_rich_nodes::list::register_list(
        builder,
        lexical_rich_nodes::list::RegisterListOptions::default(),
    );
    let builder =
        lexical_rich_nodes::normalize_triple_click::register_normalize_triple_click(builder);
    let builder = structure::register(builder);
    let builder = keyboard::register(builder);
    let builder = table::register(builder);
    let builder = code::register(builder);
    let builder = checklist::register(builder);
    let builder = media::register(builder);
    let builder = diff::register(builder);
    metadata::register(builder)
}

#[cfg(test)]
mod checklist_test;
#[cfg(test)]
mod code_test;
#[cfg(test)]
mod media_test;
#[cfg(test)]
mod test;

/// Decode a named application command into an immutable typed model payload.
/// Unknown namespaces remain available to the other surface plugin groups.
pub fn decode_command(
    name: &str,
    json: &str,
    generation: u32,
    event: Option<&KeyEvent>,
) -> Result<Option<Command>, Error> {
    if let Some(command) = media::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if let Some(command) = checklist::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if let Some(command) = code::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if name == "group-b.select-all" {
        return Ok(Some(Command::SelectAll(event.cloned())));
    }
    if name == "group-b.key" {
        let event = event.ok_or(Error::Invariant("application keyboard facts"))?;
        let command = match event.key.as_ref() {
            "Enter" => KeyCommand::Enter,
            "Tab" => KeyCommand::Tab,
            "Backspace" => KeyCommand::Backspace,
            "Delete" => KeyCommand::Delete,
            _ => return Err(Error::Invariant("application keyboard command")),
        };
        return Ok(Some(Command::Key {
            command,
            event: Some(event.clone()),
        }));
    }
    if name == NODE_TRANSFORM.name() {
        let kind: BlockKind = serde_json::from_str(json)?;
        return Ok(Some(Command::Extension(ExtensionCommand::new(
            &NODE_TRANSFORM,
            kind,
        ))));
    }
    Ok(None)
}
