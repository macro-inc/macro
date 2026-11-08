//! Media insertion, resize, durable upload adoption and deletion policy.
use super::*;
use crate::nodes::{
    CreateMedia, ImageNode, JsNumber, Maybe, MediaData, VideoNode, create_image_node,
    create_video_node,
};
use lexical_rich_nodes::list::ListItemNode;

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case")]
enum MediaAction {
    Insert {
        kind: String,
        media: CreateMedia,
        alt: Option<String>,
    },
    Resize {
        key: u32,
        width: f64,
        height: f64,
    },
    Scale {
        key: u32,
        scale: f64,
    },
    Complete {
        local_url: String,
        id: String,
        url: String,
    },
    Url {
        key: u32,
        source_id: String,
        url: String,
    },
    Delete {
        key: u32,
    },
}
#[derive(Clone, Debug)]
struct MediaCommand {
    action: MediaAction,
    generation: u32,
}
static MEDIA: CommandKey<MediaCommand> = CommandKey::new("group-b.media");
#[derive(Clone, Default)]
struct DeleteGuard(bool);
pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name != MEDIA.name() {
        return Ok(None);
    }
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &MEDIA,
        MediaCommand {
            action: serde_json::from_str(json)?,
            generation,
        },
    ))))
}
pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder
        .extension_state(DeleteGuard::default())
        .plugin(Media)
}
static COMMANDS: [CommandRegistration; 7] = [
    CommandRegistration {
        command: CommandKind::Extension(&MEDIA),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Key(KeyCommand::Backspace),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Key(KeyCommand::Delete),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::DeleteCharacter,
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::DeleteWord,
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::DeleteLine,
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::InsertParagraph,
        priority: CommandPriority::Normal,
        placement: Placement::Before,
    },
];
struct Media;
impl Plugin for Media {
    fn name(&self) -> &'static str {
        "group-b.media"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        match command {
            Command::Extension(extension) => {
                let Some(command) = extension.payload(&MEDIA) else {
                    return Ok(Handled::No);
                };
                apply(tx, command)
            }
            Command::Key {
                command: KeyCommand::Backspace | KeyCommand::Delete,
                ..
            } => {
                let keys: Vec<_> = match tx.selection() {
                    Some(Selection::Node(nodes)) => nodes.nodes(tx.view()),
                    _ => vec![],
                };
                let keys: Vec<_> = keys
                    .into_iter()
                    .filter(|key| is_media(tx, *key) && tx.is_keyboard_selectable(*key))
                    .collect();
                let handled = !keys.is_empty();
                for key in keys {
                    tx.remove(key, false)?;
                }
                tx.extension_mut::<DeleteGuard>()?.0 = handled;
                Ok(if handled { Handled::Yes } else { Handled::No })
            }
            Command::DeleteCharacter { .. }
            | Command::DeleteWord { .. }
            | Command::DeleteLine { .. } => {
                let consume = tx.extension::<DeleteGuard>()?.0;
                tx.extension_mut::<DeleteGuard>()?.0 = false;
                Ok(if consume { Handled::Yes } else { Handled::No })
            }
            Command::InsertParagraph => paragraph_above_images(tx),
            _ => Ok(Handled::No),
        }
    }
}
fn is_media(state: &impl Read, key: NodeKey) -> bool {
    state.is::<ImageNode>(key) || state.is::<VideoNode>(key)
}
fn media(state: &impl Read, key: NodeKey) -> Option<MediaData> {
    state
        .get::<ImageNode>(key)
        .map(|node| node.media.clone())
        .or_else(|| state.get::<VideoNode>(key).map(|node| node.media.clone()))
}
fn update(
    tx: &mut Transaction<'_>,
    key: NodeKey,
    change: impl FnOnce(&mut MediaData),
) -> Result<(), Error> {
    if tx.is::<ImageNode>(key) {
        change(&mut tx.get_mut::<ImageNode>(key)?.media);
    } else {
        change(&mut tx.get_mut::<VideoNode>(key)?.media);
    }
    Ok(())
}
fn apply(tx: &mut Transaction<'_>, command: &MediaCommand) -> Result<Handled, Error> {
    let key = |index| {
        NodeKey::from_parts(KeyParts {
            index,
            generation: command.generation,
        })
    };
    match &command.action {
        MediaAction::Insert { kind, media, alt } => {
            let node = match kind.as_str() {
                "image" => create_image_node(tx, media.clone(), alt.clone())?.key(),
                "video" => create_video_node(tx, media.clone(), None)?.key(),
                _ => return Err(Error::Invariant("media kind")),
            };
            insert(tx, node)?;
        }
        MediaAction::Complete { local_url, id, url } => {
            let keys: Vec<_> = tx
                .descendants(NodeKey::ROOT)
                .map(|(key, _)| key)
                .filter(|key| {
                    media(tx, *key).is_some_and(|data| {
                        data.src_type.as_deref() == Some("local")
                            && data.url.as_deref() == Some(local_url)
                    })
                })
                .collect();
            for key in keys {
                update(tx, key, |data| {
                    data.src_type = Maybe::Value("sfs".into());
                    data.id = Maybe::Value(id.clone());
                    data.url = Maybe::Value(url.clone());
                })?;
            }
            tx.add_tag(UpdateTag::Historic);
        }
        MediaAction::Resize {
            key: index,
            width,
            height,
        } => {
            let key = key(*index);
            if !tx.is_attached(key) || !is_media(tx, key) {
                return Ok(Handled::No);
            }
            update(tx, key, |data| {
                data.width = Maybe::Value(JsNumber(*width));
                data.height = Maybe::Value(JsNumber(*height));
            })?;
            tx.add_tag(UpdateTag::Historic);
        }
        MediaAction::Scale { key: index, scale } => {
            let key = key(*index);
            if !tx.is_attached(key) || !is_media(tx, key) {
                return Ok(Handled::No);
            }
            update(tx, key, |data| data.scale = JsNumber(*scale))?;
        }
        MediaAction::Url {
            key: index,
            source_id,
            url,
        } => {
            let key = key(*index);
            let Some(data) = media(tx, key).filter(|_| tx.is_attached(key)) else {
                return Ok(Handled::No);
            };
            if data.src_type.as_deref() != Some("dss") || data.id.as_deref() != Some(source_id) {
                return Ok(Handled::No);
            }
            update(tx, key, |data| data.url = Maybe::Value(url.clone()))?;
        }
        MediaAction::Delete { key: index } => {
            let key = key(*index);
            if !tx.is_attached(key) || !is_media(tx, key) {
                return Ok(Handled::No);
            }
            super::structure::remove_and_restore_selection(tx, key)?;
        }
    }
    Ok(Handled::Yes)
}
fn selected_item(tx: &Transaction<'_>) -> Option<NodeKey> {
    let range = tx
        .selection()
        .and_then(Selection::as_range)
        .filter(|range| range.is_collapsed())?;
    tx.find_matching_parent(range.anchor.key(), |state, key| {
        state.is::<ListItemNode>(key)
    })
}
fn insert(tx: &mut Transaction<'_>, node: NodeKey) -> Result<(), Error> {
    let selection = tx.selection().cloned();
    if let Some(Selection::Node(selected)) = &selection {
        let keys = selected.nodes(tx.view());
        if let Some(last) = keys.last().copied() {
            if let Some(old) = media(tx, last) {
                update(tx, node, |data| {
                    data.width = old.width;
                    data.height = old.height;
                })?;
                tx.replace(last, node, false)?;
                if keys.len() == 1 {
                    let mut selected = NodeSelection::new();
                    selected.add(node);
                    tx.set_selection(Some(Selection::Node(selected)))?;
                }
            } else {
                tx.insert_after(last, node, true)?;
            }
        }
        return Ok(());
    }
    if selection.is_none() {
        return tx.insert_nodes(&[node]);
    }
    if tx.is::<ImageNode>(node)
        && let Some(item) = selected_item(tx)
    {
        if !tx.is_empty(item) {
            return tx.append(item, &[node]);
        }
        if let Some(previous) = tx
            .prev_sibling(item)
            .filter(|key| tx.is::<ListItemNode>(*key))
        {
            let target = tx
                .last_descendant(previous)
                .and_then(|last| {
                    tx.find_matching_parent(last, |state, key| state.is::<ListItemNode>(key))
                })
                .unwrap_or(previous);
            return tx.append(target, &[node]);
        }
    }
    if let Some(Selection::Range(range)) = selection
        && range.is_collapsed()
        && range.focus.offset() == 0
        && let Some(top) = tx.top_level_element(range.focus.key())?
        && tx.first_child(NodeKey::ROOT) == Some(top)
    {
        tx.insert_before(top, node, true)?;
        return Ok(());
    }
    super::list_insert::insert_and_split_list(tx, &[node])
}
fn paragraph_above_images(tx: &mut Transaction<'_>) -> Result<Handled, Error> {
    let Some(item) = selected_item(tx) else {
        return Ok(Handled::No);
    };
    let mut images = Vec::new();
    let mut child = tx.last_child(item);
    while let Some(key) = child.filter(|key| tx.is::<ImageNode>(*key)) {
        images.push(key);
        child = tx.prev_sibling(key);
    }
    if images.is_empty() {
        return Ok(Handled::No);
    }
    images.reverse();
    for key in &images {
        tx.remove(*key, false)?;
    }
    tx.insert_paragraph()?;
    tx.append(item, &images)?;
    Ok(Handled::Yes)
}
