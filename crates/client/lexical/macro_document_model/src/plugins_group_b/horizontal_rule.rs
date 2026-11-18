//! Source horizontal-rule construction and insertion through the configured factory.
use super::*;
use crate::nodes::HorizontalRuleNode;

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {}

static INSERT: CommandKey<u32> = CommandKey::new("group-b.horizontal-rule");

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name != INSERT.name() {
        return Ok(None);
    }
    let value: serde_json::Value = serde_json::from_str(json)?;
    if !value.is_object() {
        return Err(Error::Invariant("horizontal-rule object payload"));
    }
    let _: Input = serde_json::from_value(value)?;
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &INSERT, generation,
    ))))
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(HorizontalRule)
}

struct HorizontalRule;

impl Plugin for HorizontalRule {
    fn name(&self) -> &'static str {
        "group-b.horizontal-rule"
    }

    fn commands(&self) -> &[CommandRegistration] {
        const COMMANDS: &[CommandRegistration] = &[CommandRegistration {
            command: CommandKind::Extension(&INSERT),
            priority: CommandPriority::Normal,
            placement: Placement::After,
        }];
        COMMANDS
    }

    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(extension) = command else {
            return Ok(Handled::No);
        };
        let Some(generation) = extension.payload(&INSERT) else {
            return Ok(Handled::No);
        };
        if *generation != tx.committed_state().max_key().generation() {
            return Ok(Handled::No);
        }
        let node = tx.create(HorizontalRuleNode::default())?;
        super::list_insert::insert_and_split_list(tx, &[node.key()])?;
        if tx.is_attached(node) && tx.kind(node) == Some(NodeKind::Decorator) {
            tx.select_next(node, Some(Utf16Offset::ZERO), Some(Utf16Offset::ZERO))?;
        }
        Ok(Handled::Yes)
    }
}
