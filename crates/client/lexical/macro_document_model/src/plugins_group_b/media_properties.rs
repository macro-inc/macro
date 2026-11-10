//! Source media setters and late URL upgrades, independent of native upload freshness policy.
use super::*;
use crate::nodes::{ImageNode, Maybe, MediaNode, MediaProperty, MediaType, VideoNode};

/// Source mount notification; the platform supplies actual upload-inflight state.
#[derive(Clone, Debug, PartialEq)]
pub enum MediaMountAction {
    /// No notification is due; the source mount command still consumes the event.
    None,
    /// Notify the mounted component that its upload is running.
    UploadStarted,
    /// Deliver success on a deferred platform turn, preserving the stored identity.
    UploadSucceeded {
        /// Stored identity, including source missing/null distinctions.
        id: Maybe<String>,
    },
}

/// Evaluate source mount precedence without changing the document or inferring IO state.
pub fn media_mount_action(state: &impl Read, key: NodeKey, uploading: bool) -> MediaMountAction {
    if uploading {
        return MediaMountAction::UploadStarted;
    }
    let media = state
        .get::<ImageNode>(key)
        .map(|node| &node.media)
        .or_else(|| state.get::<VideoNode>(key).map(|node| &node.media));
    match media {
        Some(media) if media.src_type.as_deref() == Some("sfs") => {
            MediaMountAction::UploadSucceeded {
                id: media.id.clone(),
            }
        }
        _ => MediaMountAction::None,
    }
}

#[derive(Clone, Debug, serde::Deserialize)]
struct PropertyUpdate {
    key: u32,
    kind: MediaType,
    #[serde(flatten)]
    property: MediaProperty,
    #[serde(default = "rerender_by_default")]
    rerender: bool,
}

fn rerender_by_default() -> bool {
    true
}

#[derive(Clone, Debug, serde::Deserialize)]
struct UrlUpgrade {
    key: u32,
    kind: MediaType,
    url: String,
}

#[derive(Clone, Debug, serde::Deserialize)]
struct Resize {
    key: u32,
    kind: MediaType,
    width: f64,
    height: f64,
}

#[derive(Clone, Debug)]
struct MediaPropertyCommand {
    key: NodeKey,
    kind: MediaType,
    properties: Vec<MediaProperty>,
    rerender: bool,
    historic: bool,
}

static PROPERTIES: CommandKey<MediaPropertyCommand> = CommandKey::new("group-b.media-set-property");
static UPGRADE_URL: CommandKey<MediaPropertyCommand> = CommandKey::new("group-b.media-upgrade-url");
static RESIZE: CommandKey<MediaPropertyCommand> = CommandKey::new("group-b.media-resize");

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    let (command, update) = if name == PROPERTIES.name() {
        let input: PropertyUpdate = serde_json::from_str(json)?;
        (
            &PROPERTIES,
            MediaPropertyCommand {
                key: NodeKey::from_parts(KeyParts {
                    index: input.key,
                    generation,
                }),
                kind: input.kind,
                properties: vec![input.property],
                rerender: input.rerender,
                historic: false,
            },
        )
    } else if name == UPGRADE_URL.name() {
        let input: UrlUpgrade = serde_json::from_str(json)?;
        (
            &UPGRADE_URL,
            MediaPropertyCommand {
                key: NodeKey::from_parts(KeyParts {
                    index: input.key,
                    generation,
                }),
                kind: input.kind,
                properties: vec![MediaProperty::Url(input.url)],
                rerender: false,
                historic: true,
            },
        )
    } else if name == RESIZE.name() {
        let input: Resize = serde_json::from_str(json)?;
        (
            &RESIZE,
            MediaPropertyCommand {
                key: NodeKey::from_parts(KeyParts {
                    index: input.key,
                    generation,
                }),
                kind: input.kind,
                properties: vec![
                    MediaProperty::Width(input.width),
                    MediaProperty::Height(input.height),
                ],
                rerender: false,
                historic: true,
            },
        )
    } else {
        return Ok(None);
    };
    Ok(Some(Command::Extension(ExtensionCommand::new(
        command, update,
    ))))
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(MediaProperties)
}

struct MediaProperties;
static COMMANDS: [CommandRegistration; 3] = [
    CommandRegistration {
        command: CommandKind::Extension(&PROPERTIES),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Extension(&UPGRADE_URL),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Extension(&RESIZE),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
];
impl Plugin for MediaProperties {
    fn name(&self) -> &'static str {
        "group-b.media-properties"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(update) = command
            .payload(&PROPERTIES)
            .or_else(|| command.payload(&UPGRADE_URL))
            .or_else(|| command.payload(&RESIZE))
        else {
            return Ok(Handled::No);
        };
        // The source caller installs Historic on its update, even if the target vanished.
        if update.historic {
            tx.add_tag(UpdateTag::Historic);
        }
        match update.kind {
            MediaType::Image if tx.is::<ImageNode>(update.key) => {
                let mut node = tx.get_mut::<ImageNode>(update.key)?;
                for property in &update.properties {
                    node.set_media_property(property.clone(), update.rerender)?;
                }
            }
            MediaType::Video if tx.is::<VideoNode>(update.key) => {
                let mut node = tx.get_mut::<VideoNode>(update.key)?;
                for property in &update.properties {
                    node.set_media_property(property.clone(), update.rerender)?;
                }
            }
            _ if command.payload(&RESIZE).is_some() => return Ok(Handled::Yes),
            _ => return Ok(Handled::No),
        }
        Ok(Handled::Yes)
    }
}

#[cfg(test)]
mod test;
