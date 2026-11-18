//! Source user-mention construction and insertion, after separate search removal.
use crate::nodes::{Maybe, UserMentionNode};
use lexical_model::*;

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UserMentionInput {
    user_id: String,
    email: String,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    mention_uuid: Maybe<String>,
}
#[derive(Clone, Debug)]
struct InsertUserMention {
    input: UserMentionInput,
    generation: u32,
}
static INSERT_USER_MENTION: CommandKey<InsertUserMention> =
    CommandKey::new("group-a.insert-user-mention");

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name != INSERT_USER_MENTION.name() {
        return Ok(None);
    }
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &INSERT_USER_MENTION,
        InsertUserMention {
            input: serde_json::from_str(json)?,
            generation,
        },
    ))))
}
pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(UserMentions)
}
fn construct(input: &UserMentionInput) -> UserMentionNode {
    let display_name = input
        .display_name
        .as_deref()
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| {
            input
                .email
                .split('@')
                .next()
                .filter(|part| !part.is_empty())
                .unwrap_or(&input.email)
        });
    UserMentionNode {
        user_id: Maybe::Value(input.user_id.clone()),
        email: Maybe::Value(input.email.clone()),
        display_name: display_name.to_owned(),
        mention_uuid: input.mention_uuid.clone(),
    }
}
struct UserMentions;
impl Plugin for UserMentions {
    fn name(&self) -> &'static str {
        "group-a.user-mention"
    }
    fn commands(&self) -> &[CommandRegistration] {
        const COMMANDS: &[CommandRegistration] = &[CommandRegistration {
            command: CommandKind::Extension(&INSERT_USER_MENTION),
            priority: CommandPriority::Normal,
            placement: Placement::After,
        }];
        COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(extension) = command else {
            return Ok(Handled::No);
        };
        let Some(command) = extension.payload(&INSERT_USER_MENTION) else {
            return Ok(Handled::No);
        };
        if command.generation != tx.committed_state().max_key().generation() {
            return Ok(Handled::No);
        }
        // The Source constructor already retains missing/null/empty UUIDs.
        // Its subsequent truthy-only setter writes that same value before insertion.
        let mention = tx.create(construct(&command.input))?;
        tx.insert_nodes_at_selection(&[mention.key()])?;
        let parent = tx.parent_or_err(mention)?;
        if tx.is_root_or_shadow_root(parent) {
            lexical_rich_nodes::utils::wrap_node_in_element(tx, mention.key(), |tx| {
                Ok(tx.create(Paragraph::default())?.key())
            })?;
        }
        // Source DecoratorNode.selectEnd is LexicalNode.selectNext(0, 0).
        tx.select_next(mention, Some(Utf16Offset::ZERO), Some(Utf16Offset::ZERO))?;
        Ok(Handled::Yes)
    }
}
#[cfg(test)]
mod test;
