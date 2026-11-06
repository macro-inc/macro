//! What makes a Notion workspace import resumable: the job recorded on its
//! run, and what a write already created.

use agent_session::domain::model::AgentSessionId;
use import_notion::domain::model::{ImportScope, NotionId};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::{NotionSharing, RunStatus};

/// The job a Notion run is doing, recorded on the run so another process can
/// pick it up.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NotionJob {
    /// Planning `scope`. Planning only reads, so it restarts from the top.
    Plan {
        /// What part of the workspace the plan covers.
        scope: ImportScope,
        /// Who the plan shares what it writes with.
        sharing: NotionSharing,
    },
    /// Planning all visible issues and groups in a connected tracker.
    TrackerPlan {
        /// Who sees the imported entities.
        sharing: NotionSharing,
    },
    /// Writing the plan tied to `review_id`.
    Write {
        /// The review that approved the plan.
        review_id: Uuid,
    },
}

/// A Notion run whose process stopped holding it, now held by the caller.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdoptedRun {
    /// Whose import it is.
    pub user: MacroUserIdStr<'static>,
    /// `running` (planning) or `importing` (writing).
    pub status: RunStatus,
    /// The job to resume; `None` when its process stopped before recording it.
    pub job: Option<NotionJob>,
    /// How many times the run has been adopted, this time included.
    pub adoptions: u16,
}

/// A Notion run as a transition left it, with the review presenting it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewedRun {
    /// The run's new status.
    pub status: RunStatus,
    /// The run's error, when it has one.
    pub error: Option<String>,
    /// The review presenting the run and its session, once both are known.
    pub review: Option<RunReview>,
}

/// The review a Notion run is tied to, and the agent session presenting it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RunReview {
    /// The review.
    pub review_id: Uuid,
    /// The session the review is presented in.
    pub session_id: AgentSessionId,
}

/// One thing a write created for a ledger row, recorded as it is created so
/// a resumed write reuses it.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, strum::EnumString, strum::AsRefStr, strum::Display,
)]
#[strum(serialize_all = "snake_case")]
pub enum WrittenKind {
    /// The folder a page with children became.
    Folder,
    /// The document a page became; minted before it is written.
    Document,
    /// The database a data source became.
    Database,
    /// That database's starter table.
    Table,
    /// That table's title column.
    TitleColumn,
    /// The database's columns were created (the id is the database).
    Schema,
    /// A data source row, by its Notion id, and the database row it became.
    Row,
    /// The folder holding a database's row bodies.
    BodiesFolder,
    /// The column linking each database row to its body.
    PageColumn,
    /// A row body, by the row's Notion id; minted before it is written.
    Body,
    /// The folder a task list became.
    TasksFolder,
    /// A task, by its row's Notion id; minted before it is written.
    Task,
    /// A relation column, by its Notion property name.
    Relation,
    /// A relation column whose rows are all linked, by property name.
    RelationLinked,
}

/// One thing a write created: `kind` for ledger row `import_id` (and, for
/// per-row kinds, the Notion `object` it stands for) is Macro's `macro_id`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WrittenObject {
    /// The ledger row it was written for.
    pub import_id: Uuid,
    /// What it is.
    pub kind: WrittenKind,
    /// The Notion row or property it is for; empty for the row's own object.
    pub object: String,
    /// The Macro id.
    pub macro_id: Uuid,
}

impl WrittenObject {
    /// The ledger row's own object of `kind`.
    pub fn own(import_id: Uuid, kind: WrittenKind, macro_id: Uuid) -> Self {
        Self {
            import_id,
            kind,
            object: String::new(),
            macro_id,
        }
    }

    /// The object of `kind` for Notion row `row`.
    pub fn for_row(import_id: Uuid, kind: WrittenKind, row: &NotionId, macro_id: Uuid) -> Self {
        Self {
            import_id,
            kind,
            object: row.as_str().to_string(),
            macro_id,
        }
    }
}

/// What a row waiting on a teammate's copy says once that teammate's import
/// stopped before writing it.
pub const TEAMMATE_STOPPED: &str =
    "A teammate's import of this stopped before it finished. Import it again.";

/// Who writes a Notion object for the team, as seen by one ledger row.
///
/// The team keeps one copy of each object (`import_entity_team_object_key`):
/// the row holding the team's claim writes it, and every other teammate's row
/// links to that copy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TeamClaim {
    /// This row holds the claim: write the object and share it.
    Held,
    /// Nobody holds a claim and this row does not take one: write a copy
    /// for the user only.
    Free,
    /// A teammate's copy exists: link to it.
    Linked {
        /// The teammate's entity.
        entity_id: String,
        /// Its type.
        entity_type: String,
    },
    /// A teammate is writing it now: wait for their row.
    Waiting {
        /// The teammate's ledger row.
        holder: Uuid,
    },
}
