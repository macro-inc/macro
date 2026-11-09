//! Late menu answers replace only the exact still-selected UTF-16 search range.
use crate::{
    nodes::*,
    plugins_group_b::{BlockKind, NODE_TRANSFORM},
};
use lexical_model::*;

/// Source menu choices retain authored node payloads rather than display labels.
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "kebab-case")]
pub enum MenuChoice {
    /// Canonical Unicode from the emoji catalog.
    Text(String),
    /// Authored person mention.
    User(UserMentionNode),
    /// Authored document, channel, task or external entity mention.
    Document(DocumentMentionNode),
    /// Authored date mention.
    Date(DateMentionNode),
    /// Authored audience group.
    Group(GroupMentionNode),
    /// Authored agent session mention.
    AgentSession(AgentSessionMentionNode),
    /// Authored booking link mention.
    BookingLink(BookingLinkMentionNode),
    /// Source block action; registry checks remain in the existing command.
    Block(BlockKind),
    /// Parsed snippet blocks, using the source placeholder replacement rules.
    Snippet(Vec<SerializedNode>),
    /// Insert a real pending placeholder before the host fetches snippet content.
    SnippetStart(SnippetStart),
}

/// Snippet identity from the same source menu rows as the web application.
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SnippetStart {
    /// Selected source document.
    pub document_id: String,
    /// Current document, for the source self-insertion guard.
    pub source_document_id: Option<String>,
}
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SnippetRequest {
    key: u32,
    generation: u32,
    await_id: String,
    document_id: String,
}
static SNIPPET_REQUEST: EventKey<SnippetRequest> = EventKey::new("group-a.snippet-request");

/// Serialize the host request after the placeholder admission commits.
pub fn event_payload(event: &PluginEvent) -> Result<Option<serde_json::Value>, Error> {
    event
        .payload(&SNIPPET_REQUEST)
        .map(serde_json::to_value)
        .transpose()
        .map_err(Error::from)
}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SnippetResolution {
    key: u32,
    await_id: String,
    nodes: Vec<SerializedNode>,
}
#[derive(Clone, Debug)]
struct ResolveCommand {
    resolution: SnippetResolution,
    generation: u32,
}
static RESOLVE: CommandKey<ResolveCommand> = CommandKey::new("group-a.snippet-resolve");

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MenuAnswer {
    key: u32,
    offset: u32,
    expected: String,
    choice: MenuChoice,
}
#[derive(Clone, Debug)]
struct MenuCommand {
    answer: MenuAnswer,
    generation: u32,
}
static SELECT: CommandKey<MenuCommand> = CommandKey::new("group-a.menu-select");

/// Decode a source menu answer; generation belongs to the receiving model.
pub fn decode_command(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name == RESOLVE.name() {
        return Ok(Some(Command::Extension(ExtensionCommand::new(
            &RESOLVE,
            ResolveCommand {
                resolution: serde_json::from_str(json)?,
                generation,
            },
        ))));
    }
    if name != SELECT.name() {
        return Ok(None);
    }
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &SELECT,
        MenuCommand {
            answer: serde_json::from_str(json)?,
            generation,
        },
    ))))
}
pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(Menu)
}
struct Menu;
impl Plugin for Menu {
    fn name(&self) -> &'static str {
        "group-a.menu"
    }
    fn commands(&self) -> &[CommandRegistration] {
        static COMMANDS: [CommandRegistration; 2] = [
            CommandRegistration {
                command: CommandKind::Extension(&SELECT),
                priority: CommandPriority::Normal,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::Extension(&RESOLVE),
                priority: CommandPriority::Normal,
                placement: Placement::After,
            },
        ];
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(extension) = command else {
            return Ok(Handled::No);
        };
        if let Some(command) = extension.payload(&RESOLVE) {
            let answer = &command.resolution;
            let key = NodeKey::from_parts(KeyParts {
                index: answer.key,
                generation: command.generation,
            });
            if !tx.is_attached(key) || !tx.is::<AwaitNode>(key) {
                return Ok(Handled::No);
            }
            if tx
                .get::<AwaitNode>(key)
                .is_none_or(|node| node.await_id.as_deref() != Some(answer.await_id.as_str()))
            {
                return Ok(Handled::No);
            }
            tx.add_tag(UpdateTag::HistoryMerge);
            replace_await(tx, key, &answer.nodes)?;
            return Ok(Handled::Yes);
        }
        let Some(command) = extension.payload(&SELECT) else {
            return Ok(Handled::No);
        };
        let answer = &command.answer;
        if let MenuChoice::SnippetStart(start) = &answer.choice
            && start.source_document_id.as_ref() == Some(&start.document_id)
        {
            return Ok(Handled::No);
        }
        let key = NodeKey::from_parts(KeyParts {
            index: answer.key,
            generation: command.generation,
        });
        if !tx.is_attached(key) || tx.composition_key().is_some() {
            return Ok(Handled::No);
        }
        if tx
            .find_matching_parent(key, |state, parent| {
                state.is::<lexical_rich_nodes::code::CodeNode>(parent)
                    || state.is::<CustomCodeNode>(parent)
            })
            .is_some()
        {
            return Ok(Handled::No);
        }
        let Some(text) = tx.view().text(key) else {
            return Ok(Handled::No);
        };
        let start = Utf16Offset(answer.offset);
        let Some(end) = start.checked_add(Utf16Offset(
            u32::try_from(answer.expected.encode_utf16().count())
                .map_err(|_| Error::Invariant("menu range length"))?,
        )) else {
            return Ok(Handled::No);
        };
        let (Ok(start_byte), Ok(end_byte)) =
            (text.text.byte_offset(start), text.text.byte_offset(end))
        else {
            return Ok(Handled::No);
        };
        let range = start_byte..end_byte;
        if answer.expected.is_empty() || text.text.as_str()[range] != answer.expected {
            return Ok(Handled::No);
        }
        let point = Point::text(key, end);
        if !matches!(tx.selection(), Some(Selection::Range(selection)) if selection.anchor == point && selection.focus == point)
        {
            return Ok(Handled::No);
        }
        tx.selection_from_view(ViewSelection::Range {
            anchor: Point::text(key, start),
            focus: point,
            resolution_dirty: false,
        })?;
        tx.remove_text()?;
        let node = match &answer.choice {
            MenuChoice::Text(text) => {
                tx.insert_text(text)?;
                return Ok(Handled::Yes);
            }
            MenuChoice::User(node) => tx.create(node.clone())?.key(),
            MenuChoice::Document(node) if node.block_name.as_deref() == Some("agent") => tx
                .create(AgentSessionMentionNode {
                    id: node.document_id.clone(),
                    label: node.document_name.clone(),
                    mention_uuid: node.mention_uuid.clone(),
                    ..Default::default()
                })?
                .key(),
            MenuChoice::Document(node) => create_document_mention_node(tx, node.clone())?.key(),
            MenuChoice::Date(node) => tx.create(node.clone())?.key(),
            MenuChoice::Group(node) => tx.create(node.clone())?.key(),
            MenuChoice::AgentSession(node) => tx.create(node.clone())?.key(),
            MenuChoice::BookingLink(node) => {
                create_booking_link_mention_node(tx, node.clone())?.key()
            }
            MenuChoice::Block(kind) => {
                let handled = tx.dispatch(&Command::Extension(ExtensionCommand::new(
                    &NODE_TRANSFORM,
                    *kind,
                )))?;
                if handled == Handled::No {
                    return Err(Error::Invariant("unavailable menu block action"));
                }
                return Ok(Handled::Yes);
            }
            MenuChoice::SnippetStart(start) => {
                let placeholder =
                    create_await_node(tx, None, Some("Inserting snippet...".into()), true)?.key();
                let await_id = tx
                    .get::<AwaitNode>(placeholder)
                    .and_then(|node| node.await_id.as_deref())
                    .ok_or(Error::Invariant("snippet await id"))?
                    .to_owned();
                tx.insert_nodes(&[placeholder])?;
                tx.emit(
                    &SNIPPET_REQUEST,
                    SnippetRequest {
                        key: placeholder.index(),
                        generation: placeholder.generation(),
                        await_id,
                        document_id: start.document_id.clone(),
                    },
                );
                return Ok(Handled::Yes);
            }
            MenuChoice::Snippet(nodes) => {
                insert_snippet(tx, nodes)?;
                return Ok(Handled::Yes);
            }
        };
        tx.insert_nodes(&[node])?;
        tx.select_end(node)?;
        Ok(Handled::Yes)
    }
}

// Port of plugins/snippets/snippetInsertion.ts: empty, sole child, inline and multi-block cases.
fn insert_snippet(tx: &mut Transaction<'_>, serialized: &[SerializedNode]) -> Result<(), Error> {
    let nodes = serialized
        .iter()
        .map(|node| tx.import_node(node))
        .collect::<Result<Vec<_>, _>>()?;
    let placeholder = tx.create(AwaitNode::default())?.key();
    tx.insert_nodes(&[placeholder])?;
    replace_await_nodes(tx, placeholder, &nodes)
}
fn replace_await(
    tx: &mut Transaction<'_>,
    placeholder: NodeKey,
    serialized: &[SerializedNode],
) -> Result<(), Error> {
    let nodes = serialized
        .iter()
        .map(|node| tx.import_node(node))
        .collect::<Result<Vec<_>, _>>()?;
    replace_await_nodes(tx, placeholder, &nodes)
}
fn replace_await_nodes(
    tx: &mut Transaction<'_>,
    placeholder: NodeKey,
    nodes: &[NodeKey],
) -> Result<(), Error> {
    let next = tx.next_sibling(placeholder);
    let previous = tx.prev_sibling(placeholder);
    if nodes.is_empty() {
        tx.remove(placeholder, false)?;
        if let Some(next) = next {
            tx.select_start(next)?
        } else if let Some(previous) = previous {
            tx.select_end(previous)?
        }
        return Ok(());
    }
    if let Some(parent) = tx
        .parent(placeholder)
        .filter(|parent| tx.is::<Paragraph>(*parent))
        && tx.children_keys(parent)?.len() == 1
    {
        replace(tx, parent, nodes)?;
    } else if nodes.len() == 1
        && tx.is::<Paragraph>(nodes[0])
        && !tx.children_keys(nodes[0])?.is_empty()
    {
        let children = tx.children_keys(nodes[0])?;
        replace(tx, placeholder, &children)?;
    } else {
        let top = tx.top_level_element(placeholder)?;
        tx.remove(placeholder, false)?;
        if let Some(mut cursor) = top {
            for node in nodes {
                tx.insert_after(cursor, *node, true)?;
                cursor = *node;
            }
        } else {
            tx.append(NodeKey::ROOT, nodes)?;
        }
        tx.select_end(*nodes.last().ok_or(Error::Invariant("snippet nodes"))?)?;
    }
    Ok(())
}
fn replace(tx: &mut Transaction<'_>, target: NodeKey, nodes: &[NodeKey]) -> Result<(), Error> {
    let mut cursor = nodes[0];
    tx.replace(target, cursor, false)?;
    for node in &nodes[1..] {
        tx.insert_after(cursor, *node, true)?;
        cursor = *node;
    }
    tx.select_end(cursor)
}
