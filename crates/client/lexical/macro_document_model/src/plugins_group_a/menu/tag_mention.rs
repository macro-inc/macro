//! Source tag-mention insertion (`INSERT_TAG_MENTION_COMMAND`), after separate search removal.
use crate::nodes::{Maybe, TagMentionNode, TagScope};
use lexical_model::*;

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TagMentionInput {
    option_id: String,
    property_definition_id: String,
    scope: TagScope,
    name: String,
    #[serde(default)]
    color: Option<String>,
}
#[derive(Clone, Debug)]
struct InsertTagMention {
    input: TagMentionInput,
    generation: u32,
}
static INSERT_TAG_MENTION: CommandKey<InsertTagMention> =
    CommandKey::new("group-a.insert-tag-mention");

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name != INSERT_TAG_MENTION.name() {
        return Ok(None);
    }
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &INSERT_TAG_MENTION,
        InsertTagMention {
            input: serde_json::from_str(json)?,
            generation,
        },
    ))))
}
pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(TagMentions)
}
fn construct(input: &TagMentionInput) -> TagMentionNode {
    // The Source constructor stores an undefined color as an absent field.
    TagMentionNode {
        option_id: Maybe::Value(input.option_id.clone()),
        property_definition_id: Maybe::Value(input.property_definition_id.clone()),
        scope: Maybe::Value(input.scope),
        name: Maybe::Value(input.name.clone()),
        color: input.color.clone().map_or(Maybe::Missing, Maybe::Value),
    }
}
struct TagMentions;
impl Plugin for TagMentions {
    fn name(&self) -> &'static str {
        "group-a.tag-mention"
    }
    fn commands(&self) -> &[CommandRegistration] {
        const COMMANDS: &[CommandRegistration] = &[CommandRegistration {
            command: CommandKind::Extension(&INSERT_TAG_MENTION),
            priority: CommandPriority::Normal,
            placement: Placement::After,
        }];
        COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(extension) = command else {
            return Ok(Handled::No);
        };
        let Some(command) = extension.payload(&INSERT_TAG_MENTION) else {
            return Ok(Handled::No);
        };
        if command.generation != tx.committed_state().max_key().generation() {
            return Ok(Handled::No);
        }
        let mention = tx.create(construct(&command.input))?;
        let range = tx.view().selection().and_then(Selection::as_range).cloned();
        if let Some(range) = range.filter(|range| !range.is_collapsed()) {
            // Source $collapseSelection(selection) collapses forwards: the
            // earlier point moves onto the later one, keeping the range format.
            let destination = if range.is_backward(tx.view())? {
                range.anchor
            } else {
                range.focus
            };
            let mut collapsed = range;
            collapsed.anchor = destination;
            collapsed.focus = destination;
            tx.set_selection(Some(Selection::Range(collapsed)))?;
            let space = tx.create_text(" ")?;
            tx.insert_nodes_at_selection(&[space.key(), mention.key()])?;
        } else {
            tx.insert_nodes_at_selection(&[mention.key()])?;
            let parent = tx.parent_or_err(mention)?;
            if tx.is_root_or_shadow_root(parent) {
                lexical_rich_nodes::utils::wrap_node_in_element(tx, mention.key(), |tx| {
                    Ok(tx.create(Paragraph::default())?.key())
                })?;
            }
        }
        // Source DecoratorNode.selectEnd is LexicalNode.selectNext(0, 0).
        tx.select_next(mention, Some(Utf16Offset::ZERO), Some(Utf16Offset::ZERO))?;
        Ok(Handled::Yes)
    }
}
#[cfg(test)]
mod test;
