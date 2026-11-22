//! Source TagMention refresh of resolved tag info (TagMentionNode.setTagInfo).
use super::*;
use crate::nodes::{Maybe, TagMentionNode, TagScope};

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TagInfoUpdate {
    key: u32,
    property_definition_id: String,
    scope: TagScope,
    name: String,
    #[serde(default)]
    color: Option<String>,
}

#[derive(Clone, Debug)]
struct TagInfoCommand {
    key: NodeKey,
    property_definition_id: String,
    scope: TagScope,
    name: String,
    color: Option<String>,
}

static TAG_INFO: CommandKey<TagInfoCommand> = CommandKey::new("group-b.tag-info");

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name != TAG_INFO.name() {
        return Ok(None);
    }
    let update: TagInfoUpdate = serde_json::from_str(json)?;
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &TAG_INFO,
        TagInfoCommand {
            key: NodeKey::from_parts(KeyParts {
                index: update.key,
                generation,
            }),
            property_definition_id: update.property_definition_id,
            scope: update.scope,
            name: update.name,
            color: update.color,
        },
    ))))
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(TagMentionActions)
}

static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&TAG_INFO),
    priority: CommandPriority::Normal,
    placement: Placement::After,
}];

struct TagMentionActions;
impl Plugin for TagMentionActions {
    fn name(&self) -> &'static str {
        "group-b.tag-mention-actions"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(update) = command.payload(&TAG_INFO) else {
            return Ok(Handled::No);
        };
        if !tx.is::<TagMentionNode>(update.key) {
            return Ok(Handled::No);
        }
        let mut node = tx.get_mut::<TagMentionNode>(update.key)?;
        node.property_definition_id = Maybe::Value(update.property_definition_id.clone());
        node.scope = Maybe::Value(update.scope);
        node.name = Maybe::Value(update.name.clone());
        node.color = update.color.clone().map_or(Maybe::Missing, Maybe::Value);
        // Source updates with [HISTORIC, SKIP_DOM_SELECTION, SKIP_SCROLL_INTO_VIEW].
        tx.add_tag(UpdateTag::Historic);
        tx.add_tag(UpdateTag::SkipDomSelection);
        tx.add_tag(UpdateTag::SkipScrollIntoView);
        Ok(Handled::Yes)
    }
}

#[cfg(test)]
mod test;
