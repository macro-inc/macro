use super::*;
use lexical_rich_nodes::{code, link, list, mark, rich_text, table};

/// Core and rich-node registry used until the application supplies its own factory.
pub fn default_editor_builder(mode: EditorMode, peer: u64) -> EditorBuilder {
    let builder = lexical_rich_nodes::register_rich_text_nodes(Editor::builder(mode));
    let builder = list::register_list_nodes(builder);
    let builder = code::register_code_nodes(builder)
        .node::<link::LinkNode>()
        .node::<link::AutoLinkNode>()
        .node::<mark::MarkNode>();
    table::register_table(builder, &table::TableConfig::default())
        .extension_state(NodeIdIndex::default())
        .plugin(RichCommands)
        .plugin(NodeIds(peer))
}

pub(super) static ID: StateKey<String> = StateKey::new("id", |value| {
    value
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_owned()
});
#[derive(Clone, Default)]
struct NodeIdIndex {
    ids: imbl::GenericOrdMap<String, NodeKey, imbl::shared_ptr::ArcK>,
    keys: imbl::GenericOrdMap<NodeKey, String, imbl::shared_ptr::ArcK>,
}
struct NodeIds(u64);
impl Plugin for NodeIds {
    fn name(&self) -> &'static str {
        "session-node-id"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, commit: &Commit) -> Result<(), Error> {
        for (key, mutation) in &commit.changes.mutations {
            let old = tx.extension::<NodeIdIndex>()?.keys.get(key).cloned();
            let mut id = if *mutation == Mutation::Destroyed || !tx.is_attached(*key) {
                None
            } else {
                Some(tx.get_state(*key, &ID)?)
            };
            if let Some(value) = &mut id
                && (value.is_empty()
                    || tx
                        .extension::<NodeIdIndex>()?
                        .ids
                        .get(value)
                        .is_some_and(|owner| owner != key))
            {
                let base = format!("session-{}-{key}", self.0);
                *value = base.clone();
                let mut suffix = 0_u64;
                while tx.extension::<NodeIdIndex>()?.ids.contains_key(value) {
                    suffix += 1;
                    *value = format!("{base}-{suffix}");
                }
                tx.set_state(*key, &ID, value.clone())?;
            }
            if old != id {
                let index = tx.extension_mut::<NodeIdIndex>()?;
                if let Some(old) = old {
                    index.ids.remove(&old);
                    index.keys.remove(key);
                }
                if let Some(id) = id {
                    index.ids.insert(id.clone(), *key);
                    index.keys.insert(*key, id);
                }
            }
        }
        Ok(())
    }
}
struct RichCommands;
impl Plugin for RichCommands {
    fn name(&self) -> &'static str {
        "session-rich-text"
    }
    fn commands(&self) -> &[CommandRegistration] {
        const KINDS: &[CommandKind] = &[
            CommandKind::InsertText,
            CommandKind::DeleteCharacter,
            CommandKind::DeleteWord,
            CommandKind::DeleteLine,
            CommandKind::RemoveText,
            CommandKind::InsertParagraph,
            CommandKind::InsertLineBreak,
            CommandKind::InsertTab,
            CommandKind::IndentContent,
            CommandKind::OutdentContent,
            CommandKind::FormatText,
            CommandKind::FormatElement,
            CommandKind::SelectAll,
            CommandKind::ClearEditor,
            CommandKind::Paste,
            CommandKind::InsertClipboardNodes,
        ];
        static REGISTRATIONS: std::sync::LazyLock<Vec<CommandRegistration>> =
            std::sync::LazyLock::new(|| {
                KINDS
                    .iter()
                    .map(|command| CommandRegistration {
                        command: *command,
                        priority: CommandPriority::Editor,
                        placement: Placement::After,
                    })
                    .collect()
            });
        &REGISTRATIONS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        if let Command::Paste(payload) = command {
            let entries = payload
                .data
                .iter()
                .map(|(mime, data)| lexical_rich_nodes::clipboard::ClipboardEntry { mime, data })
                .collect::<Vec<_>>();
            let handled = lexical_rich_nodes::clipboard::insert_data_transfer_for_rich_text(
                tx,
                "document-session",
                &entries,
                payload.html_nodes.as_deref(),
                SelectionSlot::Active,
            )?;
            return Ok(if handled { Handled::Yes } else { Handled::No });
        }
        if let Command::InsertClipboardNodes { nodes, selection } = command {
            tx.insert_nodes_at(*selection, nodes)?;
            return Ok(Handled::Yes);
        }
        let handled = match command {
            Command::InsertText(text) => rich_text::controlled_text_insertion(tx, text),
            Command::DeleteCharacter { direction, target } => {
                rich_text::delete_character(tx, *direction, target.clone())
            }
            Command::DeleteWord {
                direction,
                target,
                character_target,
            } => rich_text::delete_word(tx, *direction, target.clone(), character_target.clone()),
            Command::DeleteLine {
                direction,
                target,
                character_target,
            } => rich_text::delete_line(tx, *direction, target.clone(), character_target.clone()),
            Command::RemoveText => rich_text::remove_text(tx),
            Command::InsertParagraph => rich_text::insert_paragraph(tx),
            Command::InsertLineBreak { select_start } => {
                rich_text::insert_line_break(tx, *select_start)
            }
            Command::InsertTab => rich_text::insert_tab(tx),
            Command::IndentContent => rich_text::indent_content(tx),
            Command::OutdentContent => rich_text::outdent_content(tx),
            Command::FormatText(format) => rich_text::format_text(tx, *format),
            Command::FormatElement(format) => rich_text::format_element(tx, *format),
            Command::SelectAll(_) => rich_text::select_all(tx),
            Command::ClearEditor => rich_text::clear_editor(tx),
            _ => return Ok(Handled::No),
        }
        .map_err(|lexical_rich_nodes::Error::Model(error)| error)?;
        Ok(if handled { Handled::Yes } else { Handled::No })
    }
}
