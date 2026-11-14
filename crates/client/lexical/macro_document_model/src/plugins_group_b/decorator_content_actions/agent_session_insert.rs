//! Source INSERT_AGENT_SESSION_MENTION (mentionsPlugin.ts:657-667): insert at the
//! selection current at dispatch, wrap in a paragraph at the root, select the end.
use crate::nodes::{AgentSessionMentionNode, Maybe};
use lexical_model::*;

/// Mirrors Source AgentSessionMentionInfo; absent fields stay absent. `expanded`
/// is rejected: the native menu mirrors Source handleAgentSessionMention
/// (mentionHandlers.ts:66-80), which never sends it; an expanded card moves to the
/// root, which needs its own Source rows.
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    id: String,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    mention_uuid: Option<String>,
}

#[derive(Clone, Debug)]
struct Insert {
    input: Input,
    generation: u32,
}
static INSERT: CommandKey<Insert> = CommandKey::new("group-b.insert-agent-session-mention");

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name != INSERT.name() {
        return Ok(None);
    }
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &INSERT,
        Insert {
            input: serde_json::from_str(json)?,
            generation,
        },
    ))))
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(AgentSessionInsertion)
}

struct AgentSessionInsertion;
impl Plugin for AgentSessionInsertion {
    fn name(&self) -> &'static str {
        "group-b.agent-session-insertion"
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
        let Some(command) = extension.payload(&INSERT) else {
            return Ok(Handled::No);
        };
        if command.generation != tx.committed_state().max_key().generation() {
            return Ok(Handled::No);
        }
        let input = &command.input;
        let mention = tx
            .create(AgentSessionMentionNode {
                id: Maybe::Value(input.id.clone()),
                label: input.label.clone().map_or(Maybe::Missing, Maybe::Value),
                mention_uuid: input
                    .mention_uuid
                    .clone()
                    .map_or(Maybe::Missing, Maybe::Value),
                expanded: false,
            })?
            .key();
        // $insertNodes replaces an expanded range and falls back to the root end.
        tx.insert_nodes_at_selection(&[mention])?;
        let parent = tx.parent_or_err(mention)?;
        if tx.is_root_or_shadow_root(parent) {
            lexical_rich_nodes::utils::wrap_node_in_element(tx, mention, |tx| {
                Ok(tx.create(Paragraph::default())?.key())
            })?;
        }
        // A decorator's selectEnd is selectNext(0, 0).
        tx.select_next(mention, Some(Utf16Offset::ZERO), Some(Utf16Offset::ZERO))?;
        Ok(Handled::Yes)
    }
}
