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
    /// A multi-tab reference omitted its selected tab.
    TabChosen {
        /// The selected tab's identity for deduplication.
        view_id: NotionId,
        /// The selected tab's visible title.
        view: String,
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
    /// Explain the notice without exposing importer terminology or diagnostic keys.
    pub fn render(&self) -> String {
        let source = &self.source;
        match &self.kind {
            ImportNoticeKind::SchemaMetadataDrift => format!(
                "Database “{source}”: property names or choices changed after planning. The imported columns keep their planned definitions; choices are matched by their Notion identity when available, otherwise by name."
            ),
            ImportNoticeKind::DateScanIncomplete => {
                format!(
                    "Database “{source}”: Notion did not return all rows while checking date ranges."
                )
            }
            ImportNoticeKind::WriteScanIncomplete => {
                format!("Database “{source}”: Notion did not return all rows during import.")
            }
            ImportNoticeKind::SavedViewsUnavailable { reason } => {
                format!("Database “{source}”: saved views could not be read ({reason}).")
            }
            ImportNoticeKind::ContainerViewsUnavailable { reason } => {
                format!("Database “{source}”: views could not be read ({reason}).")
            }
            ImportNoticeKind::TabUnavailable { tab, reason } => {
                format!("Database “{source}”, saved tab {tab}: {reason}.")
            }
            ImportNoticeKind::TabChosen { view, .. } => format!(
                "Database “{source}”: Notion didn't say which tab was showing; we used “{view}”."
            ),
            ImportNoticeKind::ViewSourceMismatch => {
                format!("View “{source}” belongs to a different database and was skipped.")
            }
            ImportNoticeKind::ViewContainerMismatch => {
                format!("View “{source}” belongs to a different database location and was skipped.")
            }
            ImportNoticeKind::DatabaseViewAccessUnavailable => format!(
                "Database “{source}” could not be opened; its references were kept as Notion links."
            ),
            ImportNoticeKind::RowsOnlyPlacement { sources } => format!(
                "Database “{source}” was filed in the Notion folder because it is only linked from rows of {}.",
                sources.join(", ")
            ),
            ImportNoticeKind::PropertyChanged { property } => format!(
                "Database “{source}”: property “{property}” changed after planning. Only values that fit the planned column could be imported."
            ),
            ImportNoticeKind::PropertyAdded { property } => format!(
                "Database “{source}”: property “{property}” was added after planning and was not imported."
            ),
            ImportNoticeKind::DateEndDrift { property } => format!(
                "Database “{source}”: property “{property}” gained an end date after planning. Only the start date could be imported into its planned date column."
            ),
            ImportNoticeKind::RowBodyUnavailable => {
                format!("Page “{source}”: content could not be read; its database row was kept.")
            }
            ImportNoticeKind::DatabaseOccurrence { loss } => format!("Database “{source}”: {loss}"),
            ImportNoticeKind::PageDatabaseOccurrence { database, loss } => {
                format!("Page “{source}”, database “{database}”: {loss}.")
            }
            ImportNoticeKind::MissingContainerIdentity => {
                "A database reference could not be identified and was kept as a Notion link.".into()
            }
            ImportNoticeKind::ReferencesUnavailable { reason } => format!(
                "Page “{source}”: database references could not be checked because {reason}. The page remains in the plan."
            ),
            ImportNoticeKind::DependencyRowsUnknown => format!(
                "Database “{source}”: rows will be read during import; the row count is not yet available."
            ),
        }
    }
    pub(super) fn bound_text(&mut self, mut bound: impl FnMut(&mut String)) {
        bound(&mut self.source);
        match &mut self.kind {
            ImportNoticeKind::RowsOnlyPlacement { sources } => sources.iter_mut().for_each(bound),
            ImportNoticeKind::PropertyChanged { property }
            | ImportNoticeKind::PropertyAdded { property }
            | ImportNoticeKind::DateEndDrift { property }
            | ImportNoticeKind::TabChosen { view: property, .. } => bound(property),
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
