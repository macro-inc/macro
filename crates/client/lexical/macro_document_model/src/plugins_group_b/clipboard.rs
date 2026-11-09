//! Clipboard host facts and typed requests, keeping file I/O outside the model.
use super::*;

/// Clipboard entry carrying application paste admission facts.
pub const FACTS_MIME: &str = "application/x-macro-paste-facts";
#[derive(Clone, Debug, Default, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
/// Host clipboard facts consumed by the shared paste plugins.
pub struct PasteFacts {
    /// Correlation for asynchronous file work; zero for text-only paste.
    pub request: u32,
    /// Explicit plain paste suppresses rich Markdown transformation.
    pub plain_only: bool,
    /// The native clipboard contains file or directory entries.
    pub has_file_entries: bool,
    /// A mobile host may recover an image outside ordinary file entries.
    pub mobile_image_recovery: bool,
}
impl PasteFacts {
    pub(super) fn read(payload: &ClipboardPayload) -> Result<Self, Error> {
        payload
            .get(FACTS_MIME)
            .map(serde_json::from_str)
            .transpose()
            .map(|facts| facts.unwrap_or_default())
            .map_err(Error::from)
    }
}
#[derive(Clone, Debug, serde::Serialize)]
struct FilePasteRequest {
    request: u32,
}
static FILE_PASTE: EventKey<FilePasteRequest> = EventKey::new("group-b.file-paste");

pub(super) fn event_payload(event: &PluginEvent) -> Result<Option<serde_json::Value>, Error> {
    event
        .payload(&FILE_PASTE)
        .map(serde_json::to_value)
        .transpose()
        .map_err(Error::from)
}
pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(FilePaste)
}
struct FilePaste;
impl Plugin for FilePaste {
    fn name(&self) -> &'static str {
        "group-b.file-paste"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[CommandRegistration {
            command: CommandKind::Paste,
            priority: CommandPriority::Normal,
            placement: Placement::After,
        }]
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Paste(payload) = command else {
            return Ok(Handled::No);
        };
        let facts = PasteFacts::read(payload)?;
        if !payload.has_files && !facts.has_file_entries && !facts.mobile_image_recovery {
            return Ok(Handled::No);
        }
        tx.emit(
            &FILE_PASTE,
            FilePasteRequest {
                request: facts.request,
            },
        );
        Ok(Handled::Yes)
    }
}
