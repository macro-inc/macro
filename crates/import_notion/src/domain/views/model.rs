//! Views API shapes and the pure translator's inputs and result.
use std::collections::BTreeMap;

use models_databases::views::NewView;
use models_databases::{ColumnId, ColumnKind, OptionId};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::domain::model::NotionId;

/// The container or source whose view references are listed.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ViewScope {
    /// Views on this particular container.
    Database(NotionId),
    /// All readable views of this source, including linked views.
    DataSource(NotionId),
}

/// A retrieved Notion view. Open-ended filter/configuration objects are kept
/// intact so unsupported syntax can be reported rather than discarded on decode.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NotionView {
    /// The view's identity, separate from its source and parent container.
    pub id: NotionId,
    /// The database container displaying this view, which can differ from
    /// the source's owning container for a linked view.
    pub parent: ViewParent,
    /// Display name.
    pub name: String,
    /// Source shown; dashboards have none.
    pub data_source_id: Option<NotionId>,
    /// Presentation type.
    #[serde(rename = "type")]
    pub kind: ViewType,
    /// Saved query predicate, using data-source filter syntax.
    pub filter: Option<Value>,
    /// Sorts in priority order; null means no sorts.
    pub sorts: Option<Vec<Value>>,
    /// Type-specific presentation settings.
    pub configuration: Option<Value>,
    /// Remaining fields, retained to detect new semantic settings.
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

/// A view's parent container, as returned by the Views API.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ViewParent {
    /// The container displaying the view.
    pub database_id: NotionId,
}

/// Documented view layouts; new types are reported as unsupported.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewType {
    /// A grid.
    Table,
    /// Cards in lanes.
    Board,
    /// Date bars.
    Timeline,
    /// A simple list.
    List,
    /// Calendar.
    Calendar,
    /// Gallery.
    Gallery,
    /// Form.
    Form,
    /// Chart.
    Chart,
    /// Map.
    Map,
    /// Dashboard of views.
    Dashboard,
    /// A future layout not understood by this importer.
    #[serde(other)]
    Unknown,
}

/// A source property bound to the actual destination column, after planning.
/// Use `bindings` for the existing column plan, or supply explicit bindings
/// when the caller stores dates as date ranges or resolves other column kinds.
#[derive(Debug, Clone, PartialEq)]
pub struct ViewColumnBinding {
    /// Stable Notion property id (preferred over a matching name).
    pub property_id: String,
    /// Original Notion property name, before snapshot labels or truncation.
    pub property_name: String,
    /// Destination column.
    pub column: ColumnId,
    /// Actual destination storage kind.
    pub kind: ColumnKind,
    /// Original option labels mapped to destination option ids.
    pub options: BTreeMap<String, OptionId>,
    /// Formula/rollup text snapshots cannot preserve computed filter/sort semantics.
    pub snapshot: bool,
}

/// Which part of the saved view could not be preserved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewLossKind {
    /// A predicate or incomplete OR group was omitted, broadening the result.
    Filter,
    /// A sort key was omitted.
    Sort,
    /// Layout falls back to table.
    Layout,
    /// A presentation setting was omitted or approximated.
    Setting,
}

impl std::fmt::Display for ViewLossKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Filter => "filter approximated",
            Self::Sort => "sort omitted",
            Self::Layout => "layout approximated",
            Self::Setting => "setting approximated",
        })
    }
}

/// One machine-readable loss associated with a path in the source view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ViewLoss {
    /// Filter, sort, layout or setting.
    pub kind: ViewLossKind,
    /// JSON-style path to the unsupported source setting.
    pub path: String,
    /// Explanation suitable for an import report.
    pub reason: String,
}

/// A view creation request and all fidelity losses. Callers must surface the
/// losses in the import report before using this view for an inline card.
#[derive(Debug, Clone, PartialEq)]
pub struct TranslatedView {
    /// Source identity used to map occurrences to the newly stored view id.
    pub source_view_id: NotionId,
    /// Macro creation payload; the writer supplies its table and view identity.
    pub view: NewView,
    /// Every unsupported semantic/presentation setting encountered.
    pub losses: Vec<ViewLoss>,
}

pub(super) fn loss(losses: &mut Vec<ViewLoss>, kind: ViewLossKind, path: &str, reason: &str) {
    losses.push(ViewLoss {
        kind,
        path: path.to_owned(),
        reason: reason.to_owned(),
    });
}

pub(super) fn column<'a>(
    columns: &'a [ViewColumnBinding],
    property: &str,
) -> Option<&'a ViewColumnBinding> {
    columns
        .iter()
        .find(|column| column.property_id == property)
        .or_else(|| {
            columns
                .iter()
                .find(|column| column.property_name == property)
        })
}

// View lists require their result array and pagination flag. The shared
// search decoder deliberately tolerates omitted fields, which would turn a
// malformed view response into an apparently empty set of saved presets.
#[derive(Deserialize)]
pub(crate) struct ViewList {
    pub results: Vec<ViewReference>,
    pub has_more: bool,
    pub next_cursor: Option<String>,
    pub request_status: Option<Value>,
}

#[derive(Deserialize)]
pub(crate) struct ViewReference {
    pub id: NotionId,
}
