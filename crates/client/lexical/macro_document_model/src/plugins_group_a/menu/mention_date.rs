//! Source Date construction and insertion after separate inline-search removal.
use crate::nodes::{DateMentionNode, Maybe};
use lexical_model::*;

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DateMentionInput {
    date: String,
    display_format: String,
    #[serde(default)]
    mention_uuid: Maybe<String>,
}

#[derive(Clone, Debug)]
struct InsertDateMention {
    input: DateMentionInput,
    generation: u32,
}

static INSERT_DATE_MENTION: CommandKey<InsertDateMention> =
    CommandKey::new("group-a.insert-date-mention");

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name != INSERT_DATE_MENTION.name() {
        return Ok(None);
    }
    let value: serde_json::Value = serde_json::from_str(json)?;
    if !value.is_object() {
        return Err(Error::Invariant("date mention object payload"));
    }
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &INSERT_DATE_MENTION,
        InsertDateMention {
            input: serde_json::from_str::<DateMentionInput>(json)?,
            generation,
        },
    ))))
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(DateMentions)
}

struct DateMentions;
impl Plugin for DateMentions {
    fn name(&self) -> &'static str {
        "group-a.date-mention"
    }

    fn commands(&self) -> &[CommandRegistration] {
        const COMMANDS: &[CommandRegistration] = &[CommandRegistration {
            command: CommandKind::Extension(&INSERT_DATE_MENTION),
            priority: CommandPriority::Normal,
            placement: Placement::After,
        }];
        COMMANDS
    }

    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(extension) = command else {
            return Ok(Handled::No);
        };
        let Some(command) = extension.payload(&INSERT_DATE_MENTION) else {
            return Ok(Handled::No);
        };
        if command.generation != tx.committed_state().max_key().generation() {
            return Ok(Handled::No);
        }
        // Source copies these strings verbatim. Its truthy UUID setter repeats
        // the same constructor value, including preserving missing/null/empty.
        let mention = tx.create(DateMentionNode {
            date: Maybe::Value(command.input.date.clone()),
            display_format: Maybe::Value(command.input.display_format.clone()),
            mention_uuid: command.input.mention_uuid.clone(),
        })?;
        tx.insert_nodes_at_selection(&[mention.key()])?;
        let parent = tx.parent_or_err(mention)?;
        if tx.is_root_or_shadow_root(parent) {
            lexical_rich_nodes::utils::wrap_node_in_element(tx, mention.key(), |tx| {
                Ok(tx.create(Paragraph::default())?.key())
            })?;
        }
        // Source DecoratorNode.selectEnd delegates to selectNext(0, 0).
        tx.select_next(mention, Some(Utf16Offset::ZERO), Some(Utf16Offset::ZERO))?;
        Ok(Handled::Yes)
    }
}

#[cfg(test)]
mod test;
