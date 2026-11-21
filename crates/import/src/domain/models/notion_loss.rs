//! Typed ledger fidelity notes, rendered into the report's existing warning lines.

use std::collections::{BTreeMap, BTreeSet, HashSet};

use import_notion::domain::model::{NotionId, OptionMatch};
use serde::{Deserialize, Serialize};

/// Why an occurrence used a link or an approximate view.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReferenceLossReason {
    /// Its source was absent from the approved review.
    NotReviewed,
    /// The reviewed source was excluded or imported as tasks.
    NotImported,
    /// The connection cannot read its destination.
    NoAccess,
    /// Its destination is missing.
    NotFound,
    /// Its destination could not be resolved.
    Unresolved,
    /// No selected tab was supplied, so Notion's first tab was assumed.
    DefaultTabAssumed,
    /// Its selected tab was unavailable, so the Macro default view was used.
    DefaultView,
}

/// A source that cannot safely continue against its reserved destination.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceStopReason {
    /// The destination refused this source's schema or request.
    DatabaseRejected,
    /// The recorded source destination is no longer available.
    DestinationMissing,
    /// This source's destination denies the owner access.
    DestinationNotPermitted,
    /// A source-scoped reservation failed three times in this generation.
    ReservationRetriesExhausted,
    /// Unexpected source-local failures exhausted their consecutive budget.
    UnexpectedReservationErrors,
    /// The interrupted run never approved this external dependency in its current review.
    DependencyNotApproved,
    /// A newer worker recorded prerequisites this reader cannot interpret.
    UnsupportedMarker,
    /// An ancestor acquired an explicit grant after reservation.
    PersonalFolderShared,
    /// An older interrupted writer did not record its column-planning facts.
    MissingSchemaPlan,
    /// Stable property ids or kinds no longer fit the reserved schema.
    SchemaChanged,
    /// A readable shared database has no durable holder table marker.
    HolderMarkerMissing,
    /// Its recorded table is no longer present in the readable database.
    RecordedTableMissing,
}
impl std::fmt::Display for SourceStopReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::DatabaseRejected => "the database rejected this source's schema or request; references retain their Notion links",
            Self::DestinationMissing => "this source's database destination was not found; references retain their Notion links",
            Self::DestinationNotPermitted => "this source's database destination does not permit access; references retain their Notion links",
            Self::ReservationRetriesExhausted => "this source's database reservation could not finish after 3 attempts; references retain their Notion links",
            Self::UnexpectedReservationErrors => "an unexpected error stopped this source after 3 consecutive attempts; references retain their Notion links",
            Self::DependencyNotApproved => "external dependency was not explicitly included in this review; re-plan to include it",
            Self::UnsupportedMarker => "this import contains unsupported written markers; resume with an upgraded importer before writing this source",
            Self::PersonalFolderShared => "folder sharing changed after reservation; no personal rows were added; re-import into an owner-only folder",
            Self::MissingSchemaPlan => "this interrupted database has no recorded schema-planning facts; re-import this source to reserve its columns safely",
            Self::SchemaChanged => "Notion source schema changed after schema planning; re-import this source to reserve compatible columns",
            Self::HolderMarkerMissing => "the source holder's recorded table marker is missing; references retain their Notion links",
            Self::RecordedTableMissing => "the recorded source table no longer exists in this database; references retain their Notion links",
        })
    }
}
impl std::error::Error for SourceStopReason {}

/// Private metadata accepts existing text notes and cumulative typed counts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FidelityWarning {
    /// A source stopped without changing incompatible columns or exposing rows.
    SourceStopped {
        /// Source display title.
        title: String,
        /// Typed reason for stopping this source.
        reason: SourceStopReason,
    },
    /// Existing provider, schema and view translation notes.
    Text(String),
    /// Occurrence losses counted from durable, distinct occurrence facts.
    References {
        /// Why this reference lost fidelity.
        reason: ReferenceLossReason,
        /// Database display title.
        title: String,
        /// Cumulative distinct losses for this group.
        count: u32,
    },
    /// Select values omitted because the reserved schema has no matching option.
    OmittedOptions {
        /// Property display name.
        property: String,
        /// Option display label.
        option: String,
        /// Identity available when matching the reserved option.
        matched_by: OptionMatch,
        /// Cumulative distinct losses for this group.
        count: u32,
    },
}

impl From<String> for FidelityWarning {
    fn from(value: String) -> Self {
        Self::Text(value)
    }
}
impl From<&str> for FidelityWarning {
    fn from(value: &str) -> Self {
        Self::Text(value.to_owned())
    }
}

impl FidelityWarning {
    /// Merge repeated cumulative snapshots, not their counts, across resumed phases.
    pub fn merge(warnings: impl IntoIterator<Item = Self>) -> Vec<Self> {
        let mut text = BTreeSet::new();
        let mut stopped = BTreeSet::new();
        let mut references: BTreeMap<_, u32> = BTreeMap::new();
        let mut options: BTreeMap<_, u32> = BTreeMap::new();
        for warning in warnings {
            match warning {
                Self::SourceStopped { title, reason } => {
                    stopped.insert((title, reason));
                }
                Self::Text(message) => {
                    text.insert(message);
                }
                Self::References {
                    reason,
                    title,
                    count,
                } => {
                    let known = references.entry((reason, title)).or_default();
                    *known = (*known).max(count);
                }
                Self::OmittedOptions {
                    property,
                    option,
                    matched_by,
                    count,
                } => {
                    let known = options.entry((property, option, matched_by)).or_default();
                    *known = (*known).max(count);
                }
            }
        }
        stopped
            .into_iter()
            .map(|(title, reason)| Self::SourceStopped { title, reason })
            .chain(text.into_iter().map(Self::Text))
            .chain(
                references
                    .into_iter()
                    .map(|((reason, title), count)| Self::References {
                        reason,
                        title,
                        count,
                    }),
            )
            .chain(
                options
                    .into_iter()
                    .map(
                        |((property, option, matched_by), count)| Self::OmittedOptions {
                            property,
                            option,
                            matched_by,
                            count,
                        },
                    ),
            )
            .collect()
    }

    /// A warning suitable for users, never a serialized enum or raw object id.
    pub fn render(&self) -> String {
        match self {
            Self::SourceStopped {
                title,
                reason: SourceStopReason::UnexpectedReservationErrors,
            } => format!(
                "An unexpected error stopped {title} after 3 consecutive attempts; references retain their Notion links."
            ),
            Self::SourceStopped { title, reason } => format!("Database {title} stopped: {reason}."),
            Self::Text(message) => message.clone(),
            Self::References {
                reason,
                title,
                count,
            } => {
                let explanation = match reason {
                    ReferenceLossReason::NotReviewed => {
                        "were not reviewed; kept as named Notion links"
                    }
                    ReferenceLossReason::NotImported => {
                        "were not imported as a database; kept as named Notion links"
                    }
                    ReferenceLossReason::NoAccess => {
                        "could not be read; kept as named Notion links"
                    }
                    ReferenceLossReason::NotFound => "were not found; kept as named Notion links",
                    ReferenceLossReason::Unresolved => {
                        "could not be resolved; kept as named Notion links"
                    }
                    ReferenceLossReason::DefaultTabAssumed => {
                        "had no selected tab; default tab assumed"
                    }
                    ReferenceLossReason::DefaultView => {
                        "used the default view because the selected tab was unavailable"
                    }
                };
                format!("{count} references to database \"{title}\" {explanation}.")
            }
            Self::OmittedOptions {
                property,
                option,
                matched_by,
                count,
            } => format!(
                "{count} values of option \"{option}\" in \"{property}\" were omitted: no reserved option matched by {matched_by}. Rows containing only unmatched options show an empty cell, so views filtering on this column may hide them."
            ),
        }
    }
}

/// An occurrence or value loss persisted atomically with its row/body marker.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SourceLossFact {
    /// Original page/row identity, used only for deduplication and resume.
    pub object: NotionId,
    /// Typed loss and human-facing context, without a body snapshot.
    pub detail: SourceLossDetail,
}

/// The small facts needed to reconstruct a report after an interrupted flush.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SourceLossDetail {
    /// One database occurrence, identified independently of its display title.
    Reference {
        /// Source container identity, if readable.
        container: Option<NotionId>,
        /// Occurrence ordinal, or byte offset for a tag without identity.
        ordinal: usize,
        /// Database display title.
        title: String,
        /// Why this reference lost fidelity.
        reason: ReferenceLossReason,
    },
    /// A row option omitted by the reserved column plan.
    Option {
        /// Stable source property identity.
        property_id: String,
        /// Property display name.
        property: String,
        /// Stable source option identity, if supplied.
        option_id: Option<String>,
        /// Option display label.
        option: String,
        /// Identity available when matching the reserved option.
        matched_by: OptionMatch,
    },
    /// A body-resolution note that must survive skipping an already written body.
    Text {
        /// Human-readable detail retained across resume.
        message: String,
    },
}

impl SourceLossFact {
    /// Keep display text out of the ledger key's btree tuple budget. Source
    /// identities and occurrence ordinals remain exact for deduplication.
    pub fn bound_display_text(&mut self) {
        fn bounded(text: &mut String) {
            const MAX_BYTES: usize = 512;
            let mut output = String::new();
            let mut truncated = false;
            for character in text.chars() {
                let character = if character.is_control() {
                    ' '
                } else {
                    character
                };
                if output.len() + character.len_utf8() > MAX_BYTES - '…'.len_utf8() {
                    truncated = true;
                    break;
                }
                output.push(character);
            }
            if truncated {
                output.push('…');
            }
            *text = output;
        }
        match &mut self.detail {
            SourceLossDetail::Reference { title, .. } => bounded(title),
            SourceLossDetail::Option {
                property, option, ..
            } => {
                bounded(property);
                bounded(option);
            }
            SourceLossDetail::Text { message } => bounded(message),
        }
    }

    /// Count unique facts from completed rows together with this phase's new facts.
    pub fn warnings(facts: impl IntoIterator<Item = Self>) -> Vec<FidelityWarning> {
        let mut text = BTreeSet::new();
        let mut references: BTreeMap<_, u32> = BTreeMap::new();
        let mut options: BTreeMap<_, u32> = BTreeMap::new();
        for fact in facts.into_iter().collect::<HashSet<_>>() {
            match fact.detail {
                SourceLossDetail::Reference { title, reason, .. } => {
                    let count = references.entry((reason, title)).or_default();
                    *count = count.saturating_add(1);
                }
                SourceLossDetail::Option {
                    property,
                    option,
                    matched_by,
                    ..
                } => {
                    let count = options.entry((property, option, matched_by)).or_default();
                    *count = count.saturating_add(1);
                }
                SourceLossDetail::Text { message } => {
                    text.insert(message);
                }
            }
        }
        text.into_iter()
            .map(FidelityWarning::Text)
            .chain(references.into_iter().map(|((reason, title), count)| {
                FidelityWarning::References {
                    reason,
                    title,
                    count,
                }
            }))
            .chain(
                options
                    .into_iter()
                    .map(|((property, option, matched_by), count)| {
                        FidelityWarning::OmittedOptions {
                            property,
                            option,
                            matched_by,
                            count,
                        }
                    }),
            )
            .collect()
    }
}
