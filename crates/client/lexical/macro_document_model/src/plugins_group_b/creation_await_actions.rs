//! Composer-owned await placeholders and lazy document replacements.
use super::*;
use crate::nodes::{
    AwaitNode, DocumentMentionNode, Maybe, create_await_node, create_document_mention_node,
};

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InsertInput {
    await_id: String,
    text: String,
}
#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum BlockName {
    Task,
    Md,
}
impl BlockName {
    fn as_str(self) -> &'static str {
        match self {
            Self::Task => "task",
            Self::Md => "md",
        }
    }
}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Replacement {
    document_id: String,
    document_name: String,
    block_name: BlockName,
    #[serde(default)]
    mention_uuid: Option<String>,
}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResolveInput {
    await_id: String,
    #[serde(default)]
    replacement: Option<Replacement>,
}
#[derive(Clone, Debug)]
struct Input<T> {
    generation: u32,
    value: T,
}
static INSERT: CommandKey<Input<InsertInput>> = CommandKey::new("group-b.creation-await-insert");
static RESOLVE: CommandKey<Input<ResolveInput>> = CommandKey::new("group-b.creation-await-resolve");

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name != INSERT.name() && name != RESOLVE.name() {
        return Ok(None);
    }
    let object: serde_json::Map<String, serde_json::Value> = serde_json::from_str(json)?;
    if name == INSERT.name() {
        let value = serde_json::from_value(serde_json::Value::Object(object))?;
        return Ok(Some(Command::Extension(ExtensionCommand::new(
            &INSERT,
            Input { generation, value },
        ))));
    }
    if let Some(replacement) = object.get("replacement") {
        let fields = replacement
            .as_object()
            .ok_or(Error::Invariant("creation replacement requires an object"))?;
        if fields
            .get("mentionUuid")
            .is_some_and(|value| !value.is_string())
        {
            return Err(Error::Invariant(
                "creation mention UUID requires a string when present",
            ));
        }
    }
    let value = serde_json::from_value(serde_json::Value::Object(object))?;
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &RESOLVE,
        Input { generation, value },
    ))))
}
pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(CreationAwait)
}
struct CreationAwait;
impl Plugin for CreationAwait {
    fn name(&self) -> &'static str {
        "group-b.creation-await"
    }
    fn commands(&self) -> &[CommandRegistration] {
        const COMMANDS: &[CommandRegistration] = &[
            CommandRegistration {
                command: CommandKind::Extension(&INSERT),
                priority: CommandPriority::Normal,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::Extension(&RESOLVE),
                priority: CommandPriority::Normal,
                placement: Placement::After,
            },
        ];
        COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        if let Some(input) = command.payload(&INSERT) {
            if input.generation != tx.committed_state().max_key().generation() {
                return Ok(Handled::No);
            }
            // Source reads selection before configured construction, then collapses.
            let selection = tx.selection().cloned();
            let node = create_await_node(
                tx,
                Some(input.value.await_id.clone()),
                Some(input.value.text.clone()),
                true,
            )?;
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
                // Preserve Source's forced text point, including its Element-point error.
                tx.set_point(
                    role,
                    Point::text(destination.key(), Utf16Offset(destination.offset())),
                )?;
                let space = tx.create_text(" ")?;
                tx.insert_nodes_at_selection(&[space.key(), node.key()])?;
            } else {
                tx.insert_nodes_at_selection(&[node.key()])?;
            }
            let parent = tx.parent_or_err(node.key())?;
            if tx.is_root_or_shadow_root(parent) {
                lexical_rich_nodes::utils::wrap_node_in_element(tx, node.key(), |tx| {
                    Ok(tx.create(Paragraph::default())?.key())
                })?;
            }
            return Ok(Handled::Yes);
        }
        let Some(input) = command.payload(&RESOLVE) else {
            return Ok(Handled::No);
        };
        if input.generation != tx.committed_state().max_key().generation() {
            return Ok(Handled::No);
        }
        let target = lexical_rich_nodes::utils::dfs(tx.view(), Some(NodeKey::ROOT), None)
            .into_iter()
            .find_map(|entry| {
                tx.get::<AwaitNode>(entry.node)
                    .filter(|node| node.await_id.as_deref() == Some(input.value.await_id.as_str()))
                    .map(|_| entry.node)
            });
        // Locate the attached target before invoking a constructor or reading its clock.
        let Some(target) = target else {
            return Ok(Handled::Yes);
        };
        if let Some(replacement) = &input.value.replacement {
            let node = create_document_mention_node(
                tx,
                DocumentMentionNode {
                    document_id: Maybe::Value(replacement.document_id.clone()),
                    document_name: Maybe::Value(replacement.document_name.clone()),
                    block_name: Maybe::Value(replacement.block_name.as_str().into()),
                    mention_uuid: Maybe::from_option(replacement.mention_uuid.clone()),
                    ..Default::default()
                },
            )?;
            tx.replace(target, node.key(), false)?;
            // Source Decorator.selectEnd delegates to selectNext(0, 0).
            tx.select_next(node.key(), Some(Utf16Offset::ZERO), Some(Utf16Offset::ZERO))?;
        } else {
            let next = tx.next_sibling(target);
            let previous = tx.prev_sibling(target);
            tx.remove(target, false)?;
            if let Some(next) = next {
                if tx.kind(next) == Some(NodeKind::Decorator) {
                    tx.select_previous(next, None, None)?;
                } else {
                    tx.select_start(next)?;
                }
            } else if let Some(previous) = previous {
                if tx.kind(previous) == Some(NodeKind::Decorator) {
                    tx.select_next(previous, None, None)?;
                } else {
                    tx.select_end(previous)?;
                }
            } else {
                tx.select_end(NodeKey::ROOT)?;
            }
        }
        Ok(Handled::Yes)
    }
}
