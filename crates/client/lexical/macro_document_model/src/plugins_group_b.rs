//! Structure, list, table, media, clipboard and link model plugins.
use lexical_model::*;

#[cfg(test)]
mod booking_mention_actions_test;

mod agent_session_mention_actions;
mod booking_mention_actions;
mod checklist;
mod clipboard;
pub use clipboard::{FACTS_MIME as PASTE_FACTS_MIME, PasteFacts};
mod code;
mod database_query_actions;
mod date_mention_actions;
mod decorator_actions;
mod decorator_content_actions;
mod diff;
mod equation_insert;
mod focus;
mod format_facts;
mod formatting;
mod gif_insert;
mod horizontal_rule;
#[cfg(test)]
mod horizontal_rule_test;
mod keyboard;
mod links;
mod list_insert;
mod markdown_paste;
mod markdown_unwrap;
mod media;
mod media_properties;
mod paste_actions;
mod pinned_properties;
mod pr_mention_actions;
mod selection_snippet;
mod tag_mention_actions;
pub use media_properties::{MediaMountAction, media_mount_action};
mod metadata;
mod movement;
pub use metadata::{DOCUMENT_METADATA, DOCUMENT_VERSION};
mod structure;
pub mod table;
mod text_paste;
mod theme;
mod title_handoff;
pub use theme::parse_pasted_theme;

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

/// Register the live synced body's controls without changing registry-only imports.
pub(crate) fn register_checklist_controls(builder: EditorBuilder) -> EditorBuilder {
    checklist::register_controls(builder)
}

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
    let builder = focus::register(builder);
    let builder = horizontal_rule::register(builder);
    let builder = movement::register(builder);
    let builder = keyboard::register(builder);
    let builder = table::register(builder);
    let builder = code::register(builder);
    let builder = checklist::register(builder);
    let builder = media::register(builder);
    let builder = media_properties::register(builder);
    let builder = clipboard::register(builder);
    let builder = text_paste::register(builder);
    let builder = markdown_paste::register(builder, ty);
    let builder = links::register(builder, ty);
    let builder = diff::register(builder);
    let builder = paste_actions::register(builder);
    let builder = tag_mention_actions::register(builder);
    let builder = database_query_actions::register(builder);
    let builder = metadata::register(builder);
    let builder = decorator_actions::register(builder);
    let builder = decorator_content_actions::register(builder);
    let builder = pr_mention_actions::register(builder);
    let builder = booking_mention_actions::register(builder);
    let builder = date_mention_actions::register(builder);
    let builder = agent_session_mention_actions::register(builder);
    let builder = equation_insert::register(builder);
    let builder = gif_insert::register(builder);
    let builder = title_handoff::register(builder);
    pinned_properties::register(builder)
}

#[cfg(test)]
mod checklist_test;
#[cfg(test)]
mod clipboard_test;
#[cfg(test)]
mod code_test;
#[cfg(test)]
mod links_test;
#[cfg(test)]
mod list_identity_test;
#[cfg(test)]
mod media_test;
#[cfg(test)]
mod movement_test;
#[cfg(test)]
mod table_test;
#[cfg(test)]
mod test;
#[cfg(test)]
mod text_paste_test;

/// Decode a named application command into an immutable typed model payload.
/// Unknown namespaces remain available to the other surface plugin groups.
pub fn decode_command(
    name: &str,
    json: &str,
    generation: u32,
    event: Option<&KeyEvent>,
) -> Result<Option<Command>, Error> {
    if let Some(command) = checklist_facts::decode(name, json, generation, event)? {
        return Ok(Some(command));
    }
    if let Some(command) = formatting::decode(name, json)? {
        return Ok(Some(command));
    }
    if let Some(command) = horizontal_rule::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if let Some(command) = focus::decode(name, json)? {
        return Ok(Some(command));
    }
    if let Some(command) = table::decode_key(name, json, generation, event)? {
        return Ok(Some(command));
    }
    if let Some(command) = table::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if let Some(command) = movement::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if let Some(command) = text_paste::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if let Some(command) = links::decode(name, json)? {
        return Ok(Some(command));
    }
    if let Some(command) = media::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if let Some(command) = media_properties::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if let Some(command) = checklist::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if let Some(command) = code::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if let Some(command) = decorator_actions::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if let Some(command) = decorator_content_actions::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if let Some(command) = diff::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if let Some(command) = paste_actions::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if let Some(command) = tag_mention_actions::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if let Some(command) = database_query_actions::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if let Some(command) = pr_mention_actions::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if let Some(command) = booking_mention_actions::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if let Some(command) = date_mention_actions::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if let Some(command) = agent_session_mention_actions::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if let Some(command) = equation_insert::decode(name, json)? {
        return Ok(Some(command));
    }
    if let Some(command) = gif_insert::decode(name, json)? {
        return Ok(Some(command));
    }
    if let Some(command) = title_handoff::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if let Some(command) = pinned_properties::decode(name, json)? {
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

/// Serialize Group B host requests without exposing model event identities.
pub fn event_payload(event: &PluginEvent) -> Result<Option<serde_json::Value>, Error> {
    if let Some(payload) = text_paste::event_payload(event)? {
        return Ok(Some(payload));
    }
    if let Some(payload) = table::event_payload(event)? {
        return Ok(Some(payload));
    }
    clipboard::event_payload(event)
}

/// Execute a Group B bulk read without live handles or host callbacks.
pub fn query(
    name: &str,
    data: &serde_json::Value,
    generation: u32,
    state: &EditorState,
) -> Result<Option<serde_json::Value>, Error> {
    if let Some(reply) = format_facts::query(name, data, generation, state)? {
        return Ok(Some(reply));
    }
    if let Some(reply) = checklist_query::query(name, data, generation, state)? {
        return Ok(Some(reply));
    }
    if let Some(reply) = decorator_content_actions::query(name, data, generation, state)? {
        return Ok(Some(reply));
    }
    if let Some(reply) = table::query(name, data, generation, state)? {
        return Ok(Some(reply));
    }
    if let Some(reply) = pinned_properties::query(name, data, state)? {
        return Ok(Some(reply));
    }
    selection_snippet::query(name, data, generation, state)
}

/// Whether an application key route claims the browser default before dispatch.
pub fn key_prevents_default(name: &str) -> Option<bool> {
    (name == "group-b.table-key").then_some(false)
}

/// Read-only source checklist metadata, with no installed commands or listeners.
pub mod checklist_controls;

/// Pure checklist planning from collected metadata and actual external task facts.
pub mod checklist_plan;

mod checklist_query;

#[cfg(test)]
mod pr_mention_actions_test;

/// Explicit session-owned host facts for derived checklist presentation.
pub mod checklist_facts;

/// Native presentation deltas over one current session-owned checklist baseline.
pub mod checklist_updates;
