//! Typed import notes: render only at the report boundary.
use import_notion::domain::databases::{DatabaseLoss, ReadFailure};
use import_notion::domain::model::NotionId;
use serde::{Deserialize, Serialize};

/// Stable object identity and human context for a source-local note.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ImportNotice {
    /// Object identity for deduplication, never printed.
    pub object: NotionId,
    /// Display title of the database, page or view identified by the kind.
    pub source: String,
    /// Semantic event, without a pre-rendered sentence.
    pub kind: ImportNoticeKind,
}

/// Every notice this importer writes has an explicit semantic kind.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ImportNoticeKind {
    /// Preserve the reserved schema when labels/options changed.
    SchemaMetadataDrift,
    /// Notion did not finish the planning row scan.
    DateScanIncomplete,
    /// Notion did not finish the write-time row scan.
    WriteScanIncomplete,
    /// Source saved views cannot be read.
    SavedViewsUnavailable {
        /// Safe provider failure.
        reason: ReadFailure,
    },
    /// Container tabs cannot be read.
    ContainerViewsUnavailable {
        /// Safe provider failure.
        reason: ReadFailure,
    },
    /// A particular tab cannot be read.
    TabUnavailable {
        /// One-based tab position.
        tab: usize,
        /// Safe provider failure.
        reason: ReadFailure,
    },
    /// A saved view belongs to another source.
    ViewSourceMismatch,
    /// A tab belongs to another container.
    ViewContainerMismatch,
    /// A shared database is no longer readable.
    DatabaseViewAccessUnavailable,
    /// Only row bodies reference this source, so it uses the import root.
    RowsOnlyPlacement {
        /// Referencing source titles.
        sources: Vec<String>,
    },
    /// A property's values must fit the reserved definition.
    PropertyChanged {
        /// Property display title.
        property: String,
    },
    /// A new property has no reserved column.
    PropertyAdded {
        /// Property display title.
        property: String,
    },
    /// A reserved instant column cannot store a new end date.
    DateEndDrift {
        /// Property display title.
        property: String,
    },
    /// The row survived an unreadable body.
    RowBodyUnavailable,
    /// A body occurrence has a typed resolution loss.
    DatabaseOccurrence {
        /// Reader's semantic loss.
        loss: DatabaseLoss,
    },
    /// The planner found a loss on a selected page.
    PageDatabaseOccurrence {
        /// Database display title.
        database: String,
        /// Reader's semantic loss.
        loss: DatabaseLoss,
    },
    /// A malformed tag retains a link to its containing page.
    MissingContainerIdentity,
    /// The planner could not inspect this page's references.
    ReferencesUnavailable {
        /// Safe provider failure.
        reason: ReadFailure,
    },
    /// The dependency scan deliberately did not drain rows.
    DependencyRowsUnknown,
}

impl ImportNotice {
    /// Construct a typed note at the branch that knows its meaning.
    pub fn new(object: &NotionId, source: &str, kind: ImportNoticeKind) -> Self {
        Self {
            object: object.clone(),
            source: source.to_owned(),
            kind,
        }
    }
    /// Preserve the existing report wording without parsing diagnostic text.
    pub fn render(&self) -> String {
        let source = &self.source;
        match &self.kind {
            ImportNoticeKind::SchemaMetadataDrift => format!(
                "Database {source}: property names or options changed; preserving the reserved schema and matching values by option id when available, otherwise by name"
            ),
            ImportNoticeKind::DateScanIncomplete => {
                format!("Database {source}: Notion returned an incomplete date-range scan")
            }
            ImportNoticeKind::WriteScanIncomplete => {
                format!("Database {source}: Notion returned an incomplete write-time row query")
            }
            ImportNoticeKind::SavedViewsUnavailable { reason } => {
                format!("Database {source}: saved views unavailable ({reason})")
            }
            ImportNoticeKind::ContainerViewsUnavailable { reason } => {
                format!("Database {source}: views unavailable ({reason})")
            }
            ImportNoticeKind::TabUnavailable { tab, reason } => {
                format!("Database {source}, saved tab {tab}: {reason}")
            }
            ImportNoticeKind::ViewSourceMismatch => {
                format!("View {source}: source identity mismatch")
            }
            ImportNoticeKind::ViewContainerMismatch => {
                format!("View {source}: container identity mismatch")
            }
            ImportNoticeKind::DatabaseViewAccessUnavailable => format!(
                "Database {source}: database view access unavailable; occurrences retain Notion links"
            ),
            ImportNoticeKind::RowsOnlyPlacement { sources } => format!(
                "Database {source}: filed at the Notion folder because it is only referenced from rows of {}",
                sources.join(", ")
            ),
            ImportNoticeKind::PropertyChanged { property } => format!(
                "Database {source}: property {property} changed after planning; only values fitting the planned schema are written"
            ),
            ImportNoticeKind::PropertyAdded { property } => format!(
                "Database {source}: property {property} added after planning; values are omitted from the reserved schema"
            ),
            ImportNoticeKind::DateEndDrift { property } => format!(
                "Database {source}: property {property} acquired an end date after planning; only its start date fits the reserved Date column"
            ),
            ImportNoticeKind::RowBodyUnavailable => {
                format!("Page {source}: content could not be read; its database row was kept")
            }
            ImportNoticeKind::DatabaseOccurrence { loss } => format!("Database {source}: {loss}"),
            ImportNoticeKind::PageDatabaseOccurrence { database, loss } => {
                format!("Page \"{source}\", database \"{database}\": {loss}.")
            }
            ImportNoticeKind::MissingContainerIdentity => {
                "Database occurrence has no container identity; retained Notion link".into()
            }
            ImportNoticeKind::ReferencesUnavailable { reason } => format!(
                "Page \"{source}\": database references could not be checked because {reason}. The page remains in the plan."
            ),
            ImportNoticeKind::DependencyRowsUnknown => format!(
                "Database \"{source}\": rows will be read when imported; no row count was available from this scan."
            ),
        }
    }
    pub(super) fn bound_text(&mut self, mut bound: impl FnMut(&mut String)) {
        bound(&mut self.source);
        match &mut self.kind {
            ImportNoticeKind::RowsOnlyPlacement { sources } => sources.iter_mut().for_each(bound),
            ImportNoticeKind::PropertyChanged { property }
            | ImportNoticeKind::PropertyAdded { property }
            | ImportNoticeKind::DateEndDrift { property } => bound(property),
            ImportNoticeKind::PageDatabaseOccurrence { database, .. } => bound(database),
            ImportNoticeKind::SchemaMetadataDrift
            | ImportNoticeKind::DateScanIncomplete
            | ImportNoticeKind::WriteScanIncomplete
            | ImportNoticeKind::SavedViewsUnavailable { .. }
            | ImportNoticeKind::ContainerViewsUnavailable { .. }
            | ImportNoticeKind::TabUnavailable { .. }
            | ImportNoticeKind::ViewSourceMismatch
            | ImportNoticeKind::ViewContainerMismatch
            | ImportNoticeKind::DatabaseViewAccessUnavailable
            | ImportNoticeKind::RowBodyUnavailable
            | ImportNoticeKind::DatabaseOccurrence { .. }
            | ImportNoticeKind::MissingContainerIdentity
            | ImportNoticeKind::ReferencesUnavailable { .. }
            | ImportNoticeKind::DependencyRowsUnknown => {}
        }
    }
}
