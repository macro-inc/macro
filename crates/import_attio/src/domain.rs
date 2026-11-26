//! An Attio workspace's CRM records, read once for a reviewed import.

use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// An Attio record id (company, person or deal).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RecordId(pub Uuid);

impl std::fmt::Display for RecordId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

/// An Attio workspace member id, as actor references name owners.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct MemberId(pub Uuid);

/// An option id of a status attribute (a deal stage).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct StageId(pub Uuid);

/// The standard objects an import reads.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    strum::AsRefStr,
    strum::IntoStaticStr,
    strum::Display,
    strum::EnumIter,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum Object {
    /// `companies`.
    Companies,
    /// `people`.
    People,
    /// `deals`, off until a workspace turns it on.
    Deals,
}

impl Object {
    /// The object's API slug, as tool arguments and ledger keys name it.
    pub fn slug(self) -> &'static str {
        self.into()
    }

    /// The singular noun record pages use (`/company/<id>`).
    pub fn singular(self) -> &'static str {
        match self {
            Self::Companies => "company",
            Self::People => "person",
            Self::Deals => "deal",
        }
    }
}

/// The workspace the connection reads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Workspace {
    /// Attio's workspace id; part of every ledger key, so two workspaces never collide.
    pub id: Uuid,
    /// The workspace's URL slug (`app.attio.com/<slug>`), for record links.
    pub slug: Option<String>,
}

/// A workspace member, who can own deals.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Member {
    /// Member id.
    pub id: MemberId,
    /// Login email, matched only against the importing team's members.
    pub email: Option<String>,
}

/// One option of the deals `stage` attribute, in Attio's order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stage {
    /// Option id, as a deal's `stage` value names it.
    pub id: StageId,
    /// Display title.
    pub title: String,
    /// Attio celebrates reaching it: a won stage.
    pub celebration_enabled: bool,
    /// Archived options are kept so deals still in them resolve; the plan
    /// leaves them out of the pipeline.
    pub archived: bool,
}

/// A company record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Company {
    /// Record id.
    pub id: RecordId,
    /// Company name.
    pub name: Option<String>,
    /// Domains, primary first.
    pub domains: Vec<String>,
}

/// A person record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Person {
    /// Record id.
    pub id: RecordId,
    /// Full name as Attio writes it.
    pub full_name: Option<String>,
    /// First name.
    pub first_name: Option<String>,
    /// Last name.
    pub last_name: Option<String>,
    /// Email addresses, primary first.
    pub emails: Vec<String>,
    /// The company record it belongs to.
    pub company: Option<RecordId>,
}

/// A currency amount.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Money {
    /// The amount.
    pub amount: f64,
    /// ISO 4217 code.
    pub currency: Option<String>,
}

/// A deal record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Deal {
    /// Record id.
    pub id: RecordId,
    /// Deal name.
    pub name: Option<String>,
    /// Its stage.
    pub stage: Option<StageId>,
    /// Its value.
    pub value: Option<Money>,
    /// The member who owns it.
    pub owner: Option<MemberId>,
    /// The company it is with.
    pub company: Option<RecordId>,
    /// People linked to it; Macro pipeline entries cannot hold them.
    pub people: Vec<RecordId>,
}

/// Attributes a workspace added itself to one object. Their values are not imported.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CustomAttributes {
    /// The object.
    pub object: Object,
    /// Attribute API slugs, sorted.
    pub slugs: Vec<String>,
}

/// Every record an import plans from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Inventory {
    /// The workspace.
    pub workspace: Workspace,
    /// Workspace members.
    pub members: Vec<Member>,
    /// The deals `stage` options in Attio's order; empty without deals.
    pub stages: Vec<Stage>,
    /// Companies.
    pub companies: Vec<Company>,
    /// People.
    pub people: Vec<Person>,
    /// Deals; empty when the workspace has not turned deals on.
    pub deals: Vec<Deal>,
    /// Workspace-added attributes per object.
    pub custom_attributes: Vec<CustomAttributes>,
    /// Objects or features skipped, with a reason. Ids only, never names,
    /// emails or domains.
    pub warnings: Vec<String>,
}

/// Records read so far, for planning progress.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ReadProgress {
    /// Companies read.
    pub companies: usize,
    /// People read.
    pub people: usize,
    /// Deals read.
    pub deals: usize,
}

/// Reading a workspace failed. Nothing partial is returned.
#[derive(Debug, thiserror::Error)]
pub enum AttioError {
    /// The user has no enabled Attio connection.
    #[error("Attio is not connected")]
    NotConnected,
    /// The connection's grant stopped working; the user must sign in again.
    #[error("The Attio connection must be signed in to again")]
    NeedsReauth,
    /// Attio does not list a tool an import calls.
    #[error("Attio's MCP server does not offer the {0} tool")]
    MissingTool(&'static str),
    /// Attio kept refusing for rate limits after every retry.
    #[error("Attio is rate limiting reads; try again later")]
    Unavailable,
    /// A tool answered with an error. Its text is kept out of the error's
    /// `Display`, which spans and logs record: Attio's explanation can name
    /// the workspace or a record.
    #[error("Attio's {tool} tool failed")]
    Tool {
        /// The tool.
        tool: &'static str,
        /// Bounded provider explanation, for a caller that shows it.
        message: String,
    },
    /// An answer this importer cannot read (prose, an unknown shape), or a
    /// repeated page.
    #[error("Invalid Attio response: {0}")]
    Decode(String),
    /// Attio's server did not answer a call in time.
    #[error("Attio's {0} tool did not answer in time")]
    TimedOut(&'static str),
    /// The connection lookup or the call through it failed.
    #[error("Attio transport failed: {0}")]
    Transport(rootcause::Report),
}

/// Reads a user's connected Attio workspace. Object-safe so the durable
/// import engine can hold it without a type parameter.
#[async_trait]
pub trait AttioConnections: Send + Sync + 'static {
    /// Whether the user has an Attio connection to read through. Calls no
    /// tool.
    async fn connected(&self, user: &MacroUserIdStr<'static>) -> Result<bool, AttioError>;
    /// Read every company, person and deal, with members and deal stages,
    /// reporting counts as pages arrive.
    async fn inventory(
        &self,
        user: &MacroUserIdStr<'static>,
        progress: &(dyn Fn(ReadProgress) + Send + Sync),
    ) -> Result<Inventory, AttioError>;
}
