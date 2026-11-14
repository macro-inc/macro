//! Source document-mention edits; browser navigation and preview I/O stay in the host.
use super::*;
use crate::nodes::{
    DocumentCardNode, DocumentMentionNode, Maybe, PreviewBox, PreviewDim, SnapshotNode,
    convert_card_to_mention, convert_mention_to_card,
};
use indexmap::IndexMap;

mod agent_session_insert;
mod booking_link_insert;
mod insert;

#[derive(serde::Deserialize)]
struct Target {
    key: u32,
}

static SNAPSHOT_DELETE: CommandKey<NodeKey> = CommandKey::new("group-b.snapshot-delete");
static SNAPSHOT_COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&SNAPSHOT_DELETE),
    priority: CommandPriority::Normal,
    placement: Placement::After,
}];

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case")]
enum MentionAction {
    Remove { key: u32 },
    ToText { key: u32, text: String },
    ToCard { key: u32 },
    Collapse { key: u32, collapsed: bool },
}
impl MentionAction {
    fn key(&self) -> u32 {
        match self {
            Self::Remove { key }
            | Self::ToText { key, .. }
            | Self::ToCard { key }
            | Self::Collapse { key, .. } => *key,
        }
    }
}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case")]
enum CardAction {
    Remove {
        key: u32,
    },
    ToMention {
        key: u32,
        #[serde(default, rename = "selectEnd")]
        select_end: bool,
    },
    PreviewBox {
        key: u32,
        #[serde(rename = "previewBox")]
        preview_box: PreviewBox,
    },
    PreviewHeight {
        key: u32,
        height: String,
    },
    PreviewData {
        key: u32,
        data: serde_json::Value,
    },
    BlockParams {
        key: u32,
        params: IndexMap<String, String>,
    },
}
impl CardAction {
    fn key(&self) -> u32 {
        match self {
            Self::Remove { key }
            | Self::ToMention { key, .. }
            | Self::PreviewBox { key, .. }
            | Self::PreviewHeight { key, .. }
            | Self::PreviewData { key, .. }
            | Self::BlockParams { key, .. } => *key,
        }
    }
}
#[derive(Clone, Debug)]
struct CardCommand {
    key: NodeKey,
    action: CardAction,
}
static CARD: CommandKey<CardCommand> = CommandKey::new("group-b.document-card");

#[derive(Clone, Debug)]
struct MentionCommand {
    key: NodeKey,
    action: MentionAction,
}
#[derive(Clone, Debug, serde::Deserialize)]
struct DocumentNames {
    names: IndexMap<String, String>,
}
static MENTION: CommandKey<MentionCommand> = CommandKey::new("group-b.document-mention");
static NAMES: CommandKey<DocumentNames> = CommandKey::new("group-b.document-names");

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if let Some(command) = insert::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if let Some(command) = agent_session_insert::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if let Some(command) = booking_link_insert::decode(name, json, generation)? {
        return Ok(Some(command));
    }
    if name == SNAPSHOT_DELETE.name() {
        let target: Target = serde_json::from_str(json)?;
        return Ok(Some(Command::Extension(ExtensionCommand::new(
            &SNAPSHOT_DELETE,
            NodeKey::from_parts(KeyParts {
                index: target.key,
                generation,
            }),
        ))));
    }
    if name == CARD.name() {
        let action: CardAction = serde_json::from_str(json)?;
        return Ok(Some(Command::Extension(ExtensionCommand::new(
            &CARD,
            CardCommand {
                key: NodeKey::from_parts(KeyParts {
                    index: action.key(),
                    generation,
                }),
                action,
            },
        ))));
    }
    if name == MENTION.name() {
        let action: MentionAction = serde_json::from_str(json)?;
        return Ok(Some(Command::Extension(ExtensionCommand::new(
            &MENTION,
            MentionCommand {
                key: NodeKey::from_parts(KeyParts {
                    index: action.key(),
                    generation,
                }),
                action,
            },
        ))));
    }
    if name == NAMES.name() {
        return Ok(Some(Command::Extension(ExtensionCommand::new(
            &NAMES,
            serde_json::from_str::<DocumentNames>(json)?,
        ))));
    }
    Ok(None)
}

/// Read the current durable identity without exporting a tree or generating an id.
pub(super) fn query(
    name: &str,
    data: &serde_json::Value,
    generation: u32,
    state: &EditorState,
) -> Result<Option<serde_json::Value>, Error> {
    if name != "group-b.document-card-id" {
        return Ok(None);
    }
    #[derive(serde::Deserialize)]
    struct Target {
        key: u32,
    }
    let target: Target = serde_json::from_value(data.clone())?;
    let key = NodeKey::from_parts(KeyParts {
        index: target.key,
        generation,
    });
    if !state.view().is::<DocumentCardNode>(key) {
        return Ok(Some(serde_json::Value::Null));
    }
    let id = crate::node_ids::get_id(state.view(), key)?;
    Ok(Some(
        id.map(|id| serde_json::Value::String(id.into()))
            .unwrap_or(serde_json::Value::Null),
    ))
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    booking_link_insert::register(agent_session_insert::register(insert::register(
        builder
            .plugin(ContentActions)
            .plugin(DocumentMentionActions),
    )))
}
struct DocumentMentionActions;
static COMMANDS: [CommandRegistration; 3] = [
    CommandRegistration {
        command: CommandKind::Extension(&CARD),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Extension(&MENTION),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Extension(&NAMES),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
];
impl Plugin for DocumentMentionActions {
    fn name(&self) -> &'static str {
        "group-b.document-mention-actions"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        if let Some(update) = command.payload(&CARD) {
            match update.action {
                CardAction::PreviewHeight { .. } | CardAction::PreviewData { .. } => {
                    tx.add_tag(UpdateTag::HistoryMerge)
                }
                CardAction::BlockParams { .. } => tx.add_tag(UpdateTag::SkipDomSelection),
                _ => {}
            }
            let Some(card) = tx.view().cast::<DocumentCardNode>(update.key) else {
                return Ok(Handled::No);
            };
            match &update.action {
                CardAction::Remove { .. } => {
                    super::structure::remove_and_restore_selection(tx, card.key())?
                }
                CardAction::ToMention { select_end, .. } => {
                    let mention = convert_card_to_mention(tx, card)?;
                    if *select_end {
                        tx.select_end(mention)?;
                    }
                }
                CardAction::PreviewBox { preview_box, .. } => {
                    tx.get_mut::<DocumentCardNode>(card)?.preview_box = preview_box.clone()
                }
                CardAction::PreviewHeight { height, .. } => {
                    tx.get_mut::<DocumentCardNode>(card)?.preview_box[1] =
                        PreviewDim::Str(height.clone());
                }
                CardAction::PreviewData { data, .. } => {
                    tx.get_mut::<DocumentCardNode>(card)?.preview_data = Maybe::Value(data.clone());
                }
                CardAction::BlockParams { params, .. } => {
                    tx.get_mut::<DocumentCardNode>(card)?.block_params = params.clone();
                }
            }
            return Ok(Handled::Yes);
        }
        if let Some(update) = command.payload(&MENTION) {
            let Some(mention) = tx.view().cast::<DocumentMentionNode>(update.key) else {
                return Ok(Handled::No);
            };
            match &update.action {
                MentionAction::Remove { .. } => tx.remove(mention, false)?,
                MentionAction::ToText { text, .. } => {
                    let text = tx.create_text(text.as_str())?;
                    tx.replace(mention, text, false)?;
                }
                MentionAction::ToCard { .. } => {
                    convert_mention_to_card(tx, mention, None, Maybe::Missing)?;
                }
                MentionAction::Collapse { collapsed, .. } => {
                    tx.get_mut::<DocumentMentionNode>(mention)?.collapsed = *collapsed
                }
            }
            return Ok(Handled::Yes);
        }
        let Some(update) = command.payload(&NAMES) else {
            return Ok(Handled::No);
        };
        let changes: Vec<_> = tx
            .descendants(NodeKey::ROOT)
            .filter_map(|(key, _)| {
                let (id, previous) = if let Some(node) = tx.get::<DocumentMentionNode>(key) {
                    (&node.document_id, &node.document_name)
                } else if let Some(node) = tx.get::<DocumentCardNode>(key) {
                    (&node.document_id, &node.document_name)
                } else {
                    return None;
                };
                let property = match id {
                    Maybe::Value(value) => value.as_str(),
                    Maybe::Missing => "undefined",
                    Maybe::Null => "null",
                };
                let name = update.names.get(property)?;
                (!name.is_empty() && previous != &Maybe::Value(name.clone()))
                    .then(|| (key, name.clone()))
            })
            .collect();
        for (key, name) in changes {
            if tx.is::<DocumentMentionNode>(key) {
                tx.get_mut::<DocumentMentionNode>(key)?.document_name = Maybe::Value(name);
            } else {
                tx.get_mut::<DocumentCardNode>(key)?.document_name = Maybe::Value(name);
            }
        }
        tx.add_tag(UpdateTag::Historic);
        tx.add_tag(UpdateTag::SkipDomSelection);
        tx.add_tag(UpdateTag::SkipScrollIntoView);
        Ok(Handled::Yes)
    }
}
struct ContentActions;

impl Plugin for ContentActions {
    fn name(&self) -> &'static str {
        "group-b.decorator-content-actions"
    }

    fn commands(&self) -> &[CommandRegistration] {
        &SNAPSHOT_COMMANDS
    }

    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(key) = command.payload(&SNAPSHOT_DELETE) else {
            return Ok(Handled::No);
        };
        if !tx.is::<SnapshotNode>(*key) {
            return Ok(Handled::No);
        }
        super::structure::remove_and_restore_selection(tx, *key)?;
        Ok(Handled::Yes)
    }
}

#[cfg(test)]
mod snapshot_test;
#[cfg(test)]
mod test;
