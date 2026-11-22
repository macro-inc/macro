//! Source MarkdownPopup insertTaskMention + `$insertAtSavedPoint`: link a task
//! created from the snippet composer after the snippet, at the point saved
//! when the composer opened, without using the live selection.
use crate::nodes::{DocumentMentionNode, Maybe, create_document_mention_node};
use lexical_model::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
enum PointType {
    Text,
    Element,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
struct SavedPoint {
    key: u32,
    offset: u32,
    #[serde(rename = "type")]
    kind: PointType,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    point: SavedPoint,
    document_id: String,
    document_name: String,
    #[serde(default)]
    mention_uuid: Option<String>,
}

#[derive(Clone, Debug)]
struct Insert {
    input: Input,
    generation: u32,
}

static INSERT: CommandKey<Insert> = CommandKey::new("group-b.insert-task-mention-at-point");
/// The point just after the inserted mention, for the next linked task.
static INSERTED: EventKey<SavedPoint> = EventKey::new("group-b.task-mention-inserted");
static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&INSERT),
    priority: CommandPriority::Normal,
    placement: Placement::After,
}];

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

pub(super) fn event_payload(event: &PluginEvent) -> Result<Option<serde_json::Value>, Error> {
    event
        .payload(&INSERTED)
        .map(serde_json::to_value)
        .transpose()
        .map_err(Error::from)
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(TaskMentionInsertion)
}

/// Source `$pointAfter`.
fn point_after(tx: &Transaction<'_>, node: NodeKey) -> Result<SavedPoint, Error> {
    let parent = tx.parent_or_err(node)?;
    let index = tx
        .view()
        .index_within_parent(node)
        .ok_or(Error::Invariant("inserted task mention index"))?;
    Ok(SavedPoint {
        key: parent.index(),
        offset: index.0 + 1,
        kind: PointType::Element,
    })
}

/// Source `$insertAfter`.
fn insert_after(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    nodes: &[NodeKey],
) -> Result<NodeKey, Error> {
    let mut previous = node;
    for &inserted in nodes {
        tx.insert_after(previous, inserted, true)?;
        previous = inserted;
    }
    Ok(previous)
}

/// Where Source `$insertAtSavedPoint` puts the nodes; None when it returns null.
enum Target {
    Before(NodeKey),
    After(NodeKey),
    SplitAfter(NodeKey, Utf16Offset),
    Splice(NodeKey, u32),
}

fn target(tx: &Transaction<'_>, key: NodeKey, point: &SavedPoint) -> Option<Target> {
    let view = tx.view();
    if point.kind == PointType::Text && view.text(key).is_some() {
        let size = view.text_content_size(key);
        let offset = Utf16Offset(point.offset).min(size);
        return Some(if offset == Utf16Offset::ZERO {
            Target::Before(key)
        } else if offset == size {
            Target::After(key)
        } else {
            Target::SplitAfter(key, offset)
        });
    }
    if point.kind != PointType::Element || view.element(key).is_none() {
        return None;
    }
    let offset = point.offset.min(view.children_size(key));
    let before = (offset > 0)
        .then(|| view.child_at_index(key, ChildIndex(offset - 1)))
        .flatten();
    // Between blocks, e.g. after a checklist item: follow the block's text.
    if let Some(before) =
        before.filter(|before| view.element(*before).is_some() && !view.is_inline(*before))
    {
        return view
            .last_descendant(before)
            .filter(|leaf| view.element(*leaf).is_none())
            .map(Target::After);
    }
    // Lists, tables and the root hold only blocks.
    let first_is_block = view
        .first_child(key)
        .is_some_and(|first| view.element(first).is_some() && !view.is_inline(first));
    if first_is_block || view.parent(key).is_none() {
        return None;
    }
    Some(Target::Splice(key, offset))
}

struct TaskMentionInsertion;
impl Plugin for TaskMentionInsertion {
    fn name(&self) -> &'static str {
        "group-b.task-mention-insertion"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
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
        let key = NodeKey::from_parts(KeyParts {
            index: input.point.key,
            generation: command.generation,
        });
        if !tx.is_attached(key) {
            return Ok(Handled::No);
        }
        let Some(place) = target(tx, key, &input.point) else {
            return Ok(Handled::No);
        };
        // Source insertTaskMention's nodes: a space, then the task mention.
        let space = tx.create_text(" ")?.key();
        let mention = create_document_mention_node(
            tx,
            DocumentMentionNode {
                document_id: Maybe::Value(input.document_id.clone()),
                document_name: Maybe::Value(input.document_name.clone()),
                block_name: Maybe::Value("task".into()),
                mention_uuid: input
                    .mention_uuid
                    .clone()
                    .map_or(Maybe::Missing, Maybe::Value),
                ..Default::default()
            },
        )?
        .key();
        let nodes = [space, mention];
        match place {
            Target::Before(node) => {
                for inserted in nodes {
                    tx.insert_before(node, inserted, true)?;
                }
            }
            Target::After(node) => {
                insert_after(tx, node, &nodes)?;
            }
            Target::SplitAfter(node, offset) => {
                let first = tx
                    .text(node)?
                    .split_text(&[offset])?
                    .first()
                    .copied()
                    .unwrap_or(node);
                insert_after(tx, first, &nodes)?;
            }
            Target::Splice(element, offset) => {
                tx.splice(element, ChildIndex(offset), 0, &nodes)?;
            }
        }
        let after = point_after(tx, mention)?;
        tx.emit(&INSERTED, after);
        Ok(Handled::Yes)
    }
}
