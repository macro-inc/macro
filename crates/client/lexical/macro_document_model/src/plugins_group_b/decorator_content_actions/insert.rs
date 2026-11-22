//! Direct Source document insertion after host I/O, using the current selection.
use crate::nodes::{
    AgentSessionMentionNode, DocumentMentionNode, Maybe, create_document_mention_node,
};
use indexmap::IndexMap;
use lexical_model::*;

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    document_id: String,
    document_name: String,
    block_name: String,
    #[serde(default)]
    block_params: Option<IndexMap<String, String>>,
    #[serde(default)]
    mention_uuid: Maybe<String>,
    #[serde(default)]
    collapsed: Option<bool>,
    #[serde(default)]
    channel_type: Maybe<String>,
    #[serde(default)]
    created_at: Maybe<serde_json::Value>,
}

#[derive(Clone, Debug)]
struct Insert {
    input: Input,
    generation: u32,
}
static INSERT: CommandKey<Insert> = CommandKey::new("group-b.insert-document-mention");

/// Source insertDocumentMentionAtDragInsertPosition: a dragged item dropped beside a block.
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DropInput {
    key: u32,
    before: bool,
    mention: Input,
}
#[derive(Clone, Debug)]
struct DropMention {
    input: DropInput,
    generation: u32,
}
static DROP: CommandKey<DropMention> = CommandKey::new("group-b.drop-document-mention");

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name != INSERT.name() && name != DROP.name() {
        return Ok(None);
    }
    let value: serde_json::Value = serde_json::from_str(json)?;
    if !value.is_object() {
        return Err(Error::invariant(
            "document mention insertion requires an object",
        ));
    }
    if name == DROP.name() {
        return Ok(Some(Command::Extension(ExtensionCommand::new(
            &DROP,
            DropMention {
                input: serde_json::from_value(value)?,
                generation,
            },
        ))));
    }
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &INSERT,
        Insert {
            input: serde_json::from_value(value)?,
            generation,
        },
    ))))
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(DocumentInsertion)
}
struct DocumentInsertion;
impl Plugin for DocumentInsertion {
    fn name(&self) -> &'static str {
        "group-b.document-insertion"
    }
    fn commands(&self) -> &[CommandRegistration] {
        const COMMANDS: &[CommandRegistration] = &[
            CommandRegistration {
                command: CommandKind::Extension(&INSERT),
                priority: CommandPriority::Normal,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::Extension(&DROP),
                priority: CommandPriority::Normal,
                placement: Placement::After,
            },
        ];
        COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(extension) = command else {
            return Ok(Handled::No);
        };
        if let Some(command) = extension.payload(&DROP) {
            return drop_mention(tx, command);
        }
        let Some(command) = extension.payload(&INSERT) else {
            return Ok(Handled::No);
        };
        if command.generation != tx.committed_state().max_key().generation() {
            return Ok(Handled::No);
        }
        let selection = tx.selection().cloned();
        let mention = create_mention(tx, &command.input)?;
        if let Some(range) = selection
            .as_ref()
            .and_then(Selection::as_range)
            .filter(|range| !range.is_collapsed())
        {
            let backward = range.is_backward(tx.view())?;
            let (role, destination) = if backward {
                (PointRole::Focus, range.anchor)
            } else {
                (PointRole::Anchor, range.focus)
            };
            // Source throws when it forces an Element destination to a text point.
            // Preserve the valid boundary kind for the approved non-crashing behavior.
            tx.set_point(role, destination)?;
            let space = tx.create_text(" ")?;
            tx.insert_nodes_at_selection(&[space.key(), mention])?;
        } else {
            tx.insert_nodes_at_selection(&[mention])?;
        }
        let parent = tx.parent_or_err(mention)?;
        if tx.is_root_or_shadow_root(parent) {
            lexical_rich_nodes::utils::wrap_node_in_element(tx, mention, |tx| {
                Ok(tx.create(Paragraph::default())?.key())
            })?;
        }
        tx.select_next(mention, Some(Utf16Offset::ZERO), Some(Utf16Offset::ZERO))?;
        Ok(Handled::Yes)
    }
}

/// The mention node Source creates for INSERT_DOCUMENT_MENTION_COMMAND and for a drop.
fn create_mention(tx: &mut Transaction<'_>, input: &Input) -> Result<NodeKey, Error> {
    let mention = if input.block_name == "agent" {
        tx.create(AgentSessionMentionNode {
            id: Maybe::Value(input.document_id.clone()),
            label: Maybe::Value(input.document_name.clone()),
            ..Default::default()
        })?
        .key()
    } else {
        let created_at = match &input.created_at {
            Maybe::Missing => Maybe::Missing,
            Maybe::Null => Maybe::Null,
            Maybe::Value(value) => Maybe::Value(serde_json::from_value::<i64>(value.clone())?),
        };
        create_document_mention_node(
            tx,
            DocumentMentionNode {
                document_id: Maybe::Value(input.document_id.clone()),
                document_name: Maybe::Value(input.document_name.clone()),
                block_name: Maybe::Value(input.block_name.clone()),
                block_params: input.block_params.clone().unwrap_or_default(),
                mention_uuid: input.mention_uuid.clone(),
                collapsed: input.collapsed.unwrap_or(false),
                channel_type: input.channel_type.clone(),
                created_at,
            },
        )?
        .key()
    };
    if let Maybe::Value(uuid) = &input.mention_uuid
        && !uuid.is_empty()
    {
        if input.block_name == "agent" {
            tx.get_mut::<AgentSessionMentionNode>(mention)?.mention_uuid =
                Maybe::Value(uuid.clone());
        } else {
            tx.get_mut::<DocumentMentionNode>(mention)?.mention_uuid = Maybe::Value(uuid.clone());
        }
    }
    Ok(mention)
}

/// Source insertDocumentMentionAtDragInsertPosition: wrap the mention in a new
/// paragraph before or after the target block (`$insertWrappedBefore/After`),
/// then `mention.selectEnd()`.
fn drop_mention(tx: &mut Transaction<'_>, command: &DropMention) -> Result<Handled, Error> {
    if command.generation != tx.committed_state().max_key().generation() {
        return Ok(Handled::No);
    }
    let target = NodeKey::from_parts(KeyParts {
        index: command.input.key,
        generation: command.generation,
    });
    if target == NodeKey::ROOT || !tx.is_attached(target) {
        return Ok(Handled::No);
    }
    let mention = create_mention(tx, &command.input.mention)?;
    let paragraph = tx.create(Paragraph::default())?.key();
    tx.append(paragraph, &[mention])?;
    if command.input.before {
        tx.insert_before(target, paragraph, true)?;
    } else {
        tx.insert_after(target, paragraph, true)?;
    }
    tx.select_end(mention)?;
    Ok(Handled::Yes)
}

#[cfg(test)]
mod test;
