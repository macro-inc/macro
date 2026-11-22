//! Document version policy and Source-compatible Root-transform notifications.
use super::*;
use serde_json::{Value, json};
use std::sync::{Arc, LazyLock};

static DEFAULT_METADATA: LazyLock<Arc<Value>> = LazyLock::new(|| Arc::new(json!({"version": -1})));

/// Current stored document schema version, synchronized with the web version counter.
pub const DOCUMENT_VERSION: f64 = 11.0;
/// Source-compatible document metadata parser, isolated to live application surfaces.
pub static DOCUMENT_METADATA: StateKey<Arc<Value>> = StateKey::new("documentMetadata", |value| {
    let Some(value) = value.filter(|value| value.is_object() || value.is_array()) else {
        return Arc::clone(&DEFAULT_METADATA);
    };
    let version = value
        .get("version")
        .filter(|value| value.is_number())
        .cloned()
        .unwrap_or(json!(-1));
    let tags = value
        .get("environmentTags")
        .and_then(Value::as_array)
        .map(|tags| Value::Array(tags.iter().filter(|tag| tag.is_string()).cloned().collect()))
        .unwrap_or(Value::Null);
    Arc::new(json!({"version": version, "environmentTags": tags}))
});

/// Requested after any node-mutating commit whose previous document version was below
/// [`DOCUMENT_VERSION`], like Source documentMetadataPlugin's update listener. The host
/// answers with [`document_metadata_upgrade`] in its own following update.
pub static DOCUMENT_METADATA_UPGRADE_REQUESTED: EventKey<()> =
    EventKey::new("group-b.document-metadata-upgrade-requested");
#[derive(Clone, Debug)]
enum MetadataUpdate {
    Normalize,
    Upgrade,
}
static UPGRADE: CommandKey<MetadataUpdate> = CommandKey::new("group-b.document-metadata-upgrade");
static VERSION_ERROR: EventKey<()> = EventKey::new("group-b.document-version-error");
static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&UPGRADE),
    priority: CommandPriority::Editor,
    placement: Placement::After,
}];

/// Publish the parsed live metadata before the separately queued version upgrade.
pub fn document_metadata_normalize() -> Command {
    Command::Extension(ExtensionCommand::new(&UPGRADE, MetadataUpdate::Normalize))
}

/// Source's queued `editor.update(..., { tag: 'history-merge' })` that sets the version.
pub fn document_metadata_upgrade() -> Command {
    Command::Extension(ExtensionCommand::new(&UPGRADE, MetadataUpdate::Upgrade))
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder
        .state_export_order::<Root>(&["id", "documentMetadata", "pinnedPropertyIds"])
        .plugin(Metadata)
        .transform::<Root>(|tx, root| {
            let metadata = tx.get_state(root, &DOCUMENT_METADATA)?;
            if metadata
                .get("version")
                .and_then(Value::as_f64)
                .is_some_and(|version| version > DOCUMENT_VERSION)
            {
                tx.emit(&VERSION_ERROR, ());
            }
            Ok(())
        })
}
struct Metadata;
impl Plugin for Metadata {
    fn name(&self) -> &'static str {
        "group-b.document-metadata"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(action) = command.payload(&UPGRADE) else {
            return Ok(Handled::No);
        };
        if matches!(action, MetadataUpdate::Normalize) {
            tx.supersede_retained_root_state(
                &DOCUMENT_METADATA,
                crate::sync::RETAINED_LIVE_ROOT_STATE,
            )?;
            return Ok(Handled::Yes);
        }
        let current = tx.get_state(NodeKey::ROOT, &DOCUMENT_METADATA)?;
        if current
            .get("version")
            .and_then(Value::as_f64)
            .unwrap_or(-1.0)
            >= DOCUMENT_VERSION
        {
            // Not stale: Source's sync still writes the parsed live value (a null slot).
            tx.supersede_retained_root_state(
                &DOCUMENT_METADATA,
                crate::sync::RETAINED_LIVE_ROOT_STATE,
            )?;
            return Ok(Handled::Yes);
        }
        let mut metadata = current
            .as_object()
            .cloned()
            .ok_or(Error::Invariant("document metadata object"))?;
        metadata.insert("version".into(), lexical_model::js_number(DOCUMENT_VERSION));
        tx.add_tag(UpdateTag::HistoryMerge);
        tx.set_state(
            NodeKey::ROOT,
            &DOCUMENT_METADATA,
            Arc::new(Value::Object(metadata)),
        )?;
        Ok(Handled::Yes)
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, commit: &Commit) -> Result<(), Error> {
        // Source's RootNode transform reads the metadata on every root update, which
        // binds its parsed value (environmentTags: null) into later exports.
        tx.get_state(NodeKey::ROOT, &DOCUMENT_METADATA)?;
        if commit.changes.mutations.is_empty() {
            return Ok(());
        }
        // Initialization asks the host for its load follow-up update.
        if tx.is_initializing() {
            tx.emit(&DOCUMENT_METADATA_UPGRADE_REQUESTED, ());
            return Ok(());
        }
        let previous = commit
            .prev
            .view()
            .get_state(NodeKey::ROOT, &DOCUMENT_METADATA)?;
        if previous
            .get("version")
            .and_then(Value::as_f64)
            .unwrap_or(-1.0)
            < DOCUMENT_VERSION
        {
            tx.emit(&DOCUMENT_METADATA_UPGRADE_REQUESTED, ());
        }
        // Source's sync writes the live parsed metadata inside every local update, so a
        // stored copy lost to undo is re-emitted in this edit's own update.
        if !commit.tags.contains(&UpdateTag::Collaboration)
            && !commit.tags.contains(&UpdateTag::Historic)
        {
            tx.supersede_retained_root_state(
                &DOCUMENT_METADATA,
                crate::sync::RETAINED_LIVE_ROOT_STATE,
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;

#[cfg(test)]
mod parser_test;
