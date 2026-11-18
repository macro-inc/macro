//! Source AgentSessionMention writes: setExpanded and the first-mount markDirty
//! that lets the node transform lift a stored expanded card out of a paragraph.
use super::*;
use crate::nodes::AgentSessionMentionNode;

#[derive(Clone, Debug, serde::Deserialize)]
struct ExpandedUpdate {
    key: u32,
    expanded: bool,
}

#[derive(Clone, Debug, serde::Deserialize)]
struct NormalizeUpdate {
    key: u32,
}

#[derive(Clone, Debug)]
struct ExpandedCommand {
    key: NodeKey,
    expanded: bool,
}

static EXPANDED: CommandKey<ExpandedCommand> = CommandKey::new("group-b.agent-session-expanded");
static NORMALIZE: CommandKey<NodeKey> = CommandKey::new("group-b.agent-session-normalize");

fn key(index: u32, generation: u32) -> NodeKey {
    NodeKey::from_parts(KeyParts { index, generation })
}

fn object(json: &str) -> Result<serde_json::Value, Error> {
    let value: serde_json::Value = serde_json::from_str(json)?;
    if !value.is_object() {
        return Err(Error::Invariant("agent session mention object payload"));
    }
    Ok(value)
}

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name == EXPANDED.name() {
        let update: ExpandedUpdate = serde_json::from_value(object(json)?)?;
        return Ok(Some(Command::Extension(ExtensionCommand::new(
            &EXPANDED,
            ExpandedCommand {
                key: key(update.key, generation),
                expanded: update.expanded,
            },
        ))));
    }
    if name == NORMALIZE.name() {
        let update: NormalizeUpdate = serde_json::from_value(object(json)?)?;
        return Ok(Some(Command::Extension(ExtensionCommand::new(
            &NORMALIZE,
            key(update.key, generation),
        ))));
    }
    Ok(None)
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(AgentSessionMentionActions)
}

static COMMANDS: [CommandRegistration; 2] = [
    CommandRegistration {
        command: CommandKind::Extension(&EXPANDED),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Extension(&NORMALIZE),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
];

struct AgentSessionMentionActions;
impl Plugin for AgentSessionMentionActions {
    fn name(&self) -> &'static str {
        "group-b.agent-session-mention-actions"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        if let Some(update) = command.payload(&EXPANDED) {
            if !tx.is::<AgentSessionMentionNode>(update.key) {
                return Ok(Handled::No);
            }
            tx.get_mut::<AgentSessionMentionNode>(update.key)?.expanded = update.expanded;
            return Ok(Handled::Yes);
        }
        let Some(key) = command.payload(&NORMALIZE) else {
            return Ok(Handled::No);
        };
        if !tx.is::<AgentSessionMentionNode>(*key) {
            return Ok(Handled::No);
        }
        // Source: if (parent && !$isRootOrShadowRoot(parent)) node.markDirty().
        if let Some(parent) = tx.parent(*key)
            && !tx.is_root_or_shadow_root(parent)
        {
            tx.mark_dirty(*key)?;
        }
        Ok(Handled::Yes)
    }
}

#[cfg(test)]
mod test;
