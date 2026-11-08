//! Shared wire value types and constructor defaults.
use super::*;
/// Upstream JavaScript number serialization shared with table nodes.
pub use lexical_rich_nodes::table::JsNumber;
/// Default true used by optional constructor booleans.
pub fn default_true() -> bool {
    true
}
/// Default diff label, restored only when its input is absent.
pub fn default_diff_label() -> String {
    "AI Suggestion".into()
}
/// Preview dimensions retain strings and numeric JSON forms.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PreviewDim {
    /// CSS dimension.
    Str(String),
    /// Numeric dimension.
    Num(serde_json::Number),
}
impl Default for PreviewDim {
    fn default() -> Self {
        Self::Str(String::new())
    }
}
/// Width and height of a document preview.
pub type PreviewBox = [PreviewDim; 2];
/// Upstream default preview dimensions.
pub fn default_preview_box() -> PreviewBox {
    [
        PreviewDim::Str("100%".into()),
        PreviewDim::Str("400px".into()),
    ]
}
/// String interpolation of an absent JavaScript property.
pub(crate) fn js_optional(value: &Maybe<String>) -> &str {
    match value {
        Maybe::Missing => "undefined",
        Maybe::Null => "null",
        Maybe::Value(value) => value,
    }
}
/// Allowed classed-block tag names; unknown imported tags become div.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClassedBlockTag {
    /// Generic block.
    #[default]
    Div,
    /// Paragraph.
    P,
    /// Inline container.
    Span,
    /// Quotation.
    Blockquote,
}
/// Destination for a connection prompt.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectAppTarget {
    /// Connections settings.
    #[default]
    Connections,
    /// Agent harness configuration.
    Harness,
}
/// Diff text operation.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffStatus {
    /// Inserted text.
    #[default]
    Insert,
    /// Deleted text.
    Delete,
}
/// Owner of a tag option.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TagScope {
    /// Personal tag.
    #[default]
    User,
    /// Team tag.
    Team,
}
/// Paste provenance; unknown inputs normalize to pasted.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PasteOrigin {
    /// Clipboard paste.
    #[default]
    Pasted,
    /// Referenced context.
    Referenced,
}
/// Agent process lifecycle status.
#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, strum::IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum MagicChipStatus {
    /// No active turn.
    #[default]
    NoMessages,
    /// Process starting.
    Booting,
    /// Process ready.
    AcpReady,
    /// Process stopping.
    ShuttingDown,
    /// Process disconnected.
    Disconnected,
}
impl MagicChipStatus {
    /// Stored status spelling.
    pub fn as_str(self) -> &'static str {
        self.into()
    }
}
/// Author of a prompted agent turn.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MagicChipAuthor {
    /// User turn.
    #[default]
    User,
    /// Agent turn.
    Agent,
}
/// One agent turn.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MagicChipMessage {
    /// Turn index.
    pub turn: u64,
    /// Message author.
    pub author: MagicChipAuthor,
}
/// Parent entity of a reply target.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplyTargetParentType {
    /// Channel.
    #[default]
    Channel,
    /// Document.
    Document,
    /// Initiative.
    Initiative,
    /// CRM company.
    CrmCompany,
    /// CRM contact.
    CrmContact,
    /// Call.
    Call,
}
/// Validated reply parent; unknown parent fields are excluded per S3's declared divergence.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ReplyTargetParent {
    /// Entity type.
    #[serde(rename = "type")]
    pub kind: ReplyTargetParentType,
    /// Nonempty entity identifier.
    pub id: String,
}
/// Serialized media fields in MediaNode.exportJSON order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaData {
    /// Source transport.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub src_type: Maybe<String>,
    /// Storage identifier.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub id: Maybe<String>,
    /// Media URL.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub url: Maybe<String>,
    /// Stored width.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub width: Maybe<JsNumber>,
    /// Stored height.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub height: Maybe<JsNumber>,
    /// Display scale; falsy input becomes one.
    pub scale: JsNumber,
    /// Maximum width.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub constrained_width: Maybe<JsNumber>,
    /// Maximum height.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub constrained_height: Maybe<JsNumber>,
}
/// Query visualization.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseQueryDisplayMode {
    /// Single value.
    #[default]
    Scalar,
    /// Table.
    Table,
    /// Bar chart.
    Bar,
    /// Line chart.
    Line,
    /// Area chart.
    Area,
    /// Scatter chart.
    Scatter,
    /// Pie chart.
    Pie,
}
/// Validated chart fields.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct DatabaseQueryChart {
    /// Category column.
    pub x: String,
    /// One to five distinct series columns.
    pub y: Vec<String>,
    /// Chart title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Color grouping column.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Stack series.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub stack: bool,
}
/// Validated database query payload.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseQueryData {
    /// Query identifier.
    pub query_id: String,
    /// Optional database identifier.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database_id: Option<String>,
    /// Optional table identifier.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table_id: Option<String>,
    /// Display title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Original question.
    pub prompt: String,
    /// Visualization mode.
    pub display_mode: DatabaseQueryDisplayMode,
    /// Chart configuration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chart: Option<DatabaseQueryChart>,
    /// View height.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<serde_json::Number>,
}

impl Default for MediaData {
    fn default() -> Self {
        Self {
            src_type: Maybe::Missing,
            id: Maybe::Missing,
            url: Maybe::Missing,
            width: Maybe::Missing,
            height: Maybe::Missing,
            scale: JsNumber(1.0),
            constrained_width: Maybe::Missing,
            constrained_height: Maybe::Missing,
        }
    }
}
