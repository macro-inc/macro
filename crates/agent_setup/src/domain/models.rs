//! What the setup tools report back to the agent.
//!
//! Results are short summaries an agent can act on: names, counts, links and
//! one `next_step` phrased as an instruction. Candidate ids are shortened to
//! refs; nothing here carries the content of the person's documents.

use chrono::{DateTime, Utc};
use import::domain::models::NotionSharing;
use schemars::JsonSchema;
use serde::Serialize;

/// The handle for one person's setup. Stable for the account, so any step can
/// be retried or resumed from a fresh conversation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(transparent)]
pub struct SetupId(pub String);

/// How setup treats one of the person's apps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SupportKind {
    /// The email inbox, connected through Google.
    Inbox,
    /// A tool they're leaving that Macro imports: connect, discover, plan,
    /// import.
    Import,
    /// A tool they're leaving that Macro can't import yet: connected now, so
    /// it comes in once Macro can import it.
    ImportLater,
    /// A tool they keep: connected so Macro works with it live; nothing is
    /// imported.
    Keep,
    /// A tool setup doesn't know: it can be connected so agents in Macro can
    /// use it, but nothing is imported.
    ConnectOnly,
    /// Macro can neither import nor connect it.
    Unsupported,
}

/// Where one app is in setup.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AppStage {
    /// The person still has to connect it.
    NotConnected,
    /// Connected; discovery has not started.
    Connected,
    /// Macro is looking through it for what to bring over.
    Discovering,
    /// Candidates are ready for the plan.
    ReadyForPlan,
    /// Approved items are being copied in.
    Importing,
    /// Everything approved has been copied in.
    Imported,
    /// Discovery finished and found nothing to bring over.
    NothingFound,
    /// Discovery failed; see the note.
    DiscoveryFailed,
    /// The app has no import step.
    NotApplicable,
}

/// The account itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
pub struct AccountSummary {
    /// The account's email.
    pub email: String,
    /// Whether this setup is led by the person's agent (the web onboarding
    /// flow is skipped).
    pub agent_led: bool,
    /// Whether the person already finished onboarding on the web.
    pub onboarded_on_web: bool,
}

/// The email inbox.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
pub struct InboxSummary {
    /// Whether an inbox is connected.
    pub connected: bool,
    /// The connected addresses.
    pub addresses: Vec<String>,
}

/// One app in the setup.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
pub struct AppSummary {
    /// Canonical app id, e.g. `notion`. Pass this to the other setup tools.
    pub app: String,
    /// Display name.
    pub name: String,
    /// How setup treats it.
    pub support: SupportKind,
    /// Whether it is connected to Macro.
    pub connected: bool,
    /// Where it is in setup.
    pub stage: AppStage,
    /// Items found and waiting for the plan.
    pub candidates: u32,
    /// Items being copied in now.
    pub importing: u32,
    /// Items already in Macro.
    pub imported: u32,
    /// Items that failed to come in.
    pub failed: u32,
    /// Anything the person should know about this app.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// The whole setup at a glance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
pub struct SetupState {
    /// This setup's handle.
    pub setup_id: SetupId,
    /// The account.
    pub account: AccountSummary,
    /// The email inbox.
    pub inbox: InboxSummary,
    /// The person's apps.
    pub apps: Vec<AppSummary>,
    /// What is still missing, in plain words.
    pub missing: Vec<String>,
    /// What to do next.
    pub next_step: String,
}

/// What a handoff link asks the person to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum HandoffKind {
    /// Connect an app to Macro.
    Connect,
    /// Connect the Gmail inbox.
    ConnectInbox,
    /// Upload an export archive (Slack history).
    UploadArchive,
    /// Import a CSV (CRM companies).
    CsvImport,
}

/// A Macro page the person opens to do the one thing only they can do.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
pub struct Handoff {
    /// The app it is for.
    pub app: String,
    /// What it asks the person to do.
    pub kind: HandoffKind,
    /// The page. Show it to the person as a link.
    pub url: String,
    /// When the link stops working; `None` for pages that do not expire.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<DateTime<Utc>>,
    /// What the person will see when they open it.
    pub user_will_see: String,
    /// How to pick up once they are done (or if the link expired).
    pub resume: String,
}

/// A note about one app: why setup can't connect it and what to offer
/// instead, or what happens with a tool the person keeps.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
pub struct AppNote {
    /// The app.
    pub app: String,
    /// Why, and what to offer instead.
    pub note: String,
}

/// What `SetupConnect` produced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
pub struct ConnectResult {
    /// This setup's handle.
    pub setup_id: SetupId,
    /// One link per app still to connect.
    pub handoffs: Vec<Handoff>,
    /// Apps that were already connected.
    pub already_connected: Vec<String>,
    /// Connected apps Macro is looking through now.
    pub looking_through: Vec<String>,
    /// Apps that cannot be connected, with what to offer instead.
    pub not_connectable: Vec<AppNote>,
    /// What to do next.
    pub next_step: String,
}

/// One item Macro found and could bring over.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
pub struct Candidate {
    /// Short reference for this item. Use it in the plan.
    #[serde(rename = "ref")]
    pub reference: String,
    /// The item's title.
    pub title: String,
    /// A short description (team, status, members), when there is one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// A count of candidates in one area (a Linear team, say).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
pub struct CandidateGroup {
    /// The area.
    pub label: String,
    /// How many candidates are in it.
    pub count: u32,
}

/// Where discovery is for one app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DiscoveryStatus {
    /// Connected, but Macro hasn't started looking through it.
    NotStarted,
    /// Still looking.
    Discovering,
    /// Candidates are ready for the plan.
    Ready,
    /// Finished; nothing to bring over.
    NothingFound,
    /// Already brought in earlier; nothing new to plan.
    AlreadyImported,
    /// Failed; see the note.
    Failed,
    /// The app is not connected yet.
    NotConnected,
    /// Macro does not import this app.
    NotImportable,
}

/// Discovery for one app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
pub struct AppDiscovery {
    /// The app.
    pub app: String,
    /// Display name.
    pub name: String,
    /// Where discovery is.
    pub status: DiscoveryStatus,
    /// What was found, waiting for the plan.
    pub candidates: Vec<Candidate>,
    /// Candidates by area.
    pub groups: Vec<CandidateGroup>,
    /// Anything the person should know.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// What `SetupDiscover` found.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
pub struct DiscoverResult {
    /// This setup's handle.
    pub setup_id: SetupId,
    /// One entry per app.
    pub apps: Vec<AppDiscovery>,
    /// What to do next.
    pub next_step: String,
}

/// A plan the person approves once, in the chat.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
pub struct ProposedPlan {
    /// This setup's handle.
    pub setup_id: SetupId,
    /// Identifies exactly this selection. Pass it to `SetupImport` with the
    /// same selection once the person approves.
    pub plan_id: String,
    /// The plan, ready to show the person as written.
    pub plan_text: String,
    /// How many items it imports.
    pub will_import: u32,
    /// What to do next.
    pub next_step: String,
}

/// What `SetupImport` started.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
pub struct ImportStarted {
    /// This setup's handle.
    pub setup_id: SetupId,
    /// The plan that was run.
    pub plan_id: String,
    /// Items that started copying in now.
    pub started: u32,
    /// Items from the plan that were already copying in or already in Macro.
    pub already_underway: u32,
    /// What to do next.
    pub next_step: String,
}

/// How far along setup is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReportStatus {
    /// Setup isn't finished: something is still to connect, look through or
    /// approve.
    NotStarted,
    /// Items are still copying in.
    InProgress,
    /// Nothing is left for setup to do, whether or not anything came in.
    Done,
}

/// Progress for one app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
pub struct AppProgress {
    /// The app.
    pub app: String,
    /// Items in Macro.
    pub imported: u32,
    /// Items still copying in.
    pub importing: u32,
    /// Items that failed.
    pub failed: u32,
}

/// One item in the final report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
pub struct ReportItem {
    /// The app it came from.
    pub app: String,
    /// Its title.
    pub title: String,
    /// Where it is in Macro, for items that came in.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    /// Why it did not come in, for items that did not.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Something setup does not bring over, and what to do instead.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
pub struct NotCovered {
    /// The app.
    pub app: String,
    /// Display name.
    pub name: String,
    /// Why it is not covered.
    pub reason: String,
    /// What the person can do instead, with a link when there is one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alternative: Option<Handoff>,
}

/// The import report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
pub struct SetupReport {
    /// This setup's handle.
    pub setup_id: SetupId,
    /// How far along the import is.
    pub status: ReportStatus,
    /// Per-app progress.
    pub progress: Vec<AppProgress>,
    /// What came in, with links.
    pub imported: Vec<ReportItem>,
    /// What did not come in, and why.
    pub not_imported: Vec<ReportItem>,
    /// What setup does not bring over, with alternatives.
    pub not_covered: Vec<NotCovered>,
    /// Tools the person keeps: connected, and Macro works with them live.
    pub stays_connected: Vec<AppNote>,
    /// What to do next.
    pub next_step: String,
}

/// The person's choice for one app, as the agent passes it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Selection {
    /// The app.
    pub app: String,
    /// Bring every candidate.
    pub all: bool,
    /// Or bring these candidate refs.
    pub refs: Vec<String>,
}

/// A whole plan request.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PlanRequest {
    /// Per-app selections.
    pub selections: Vec<Selection>,
    /// Candidate refs the person said no to. They are left out, never
    /// discarded, so they can still be brought in later.
    pub declined: Vec<String>,
    /// What the person asked for, in their words, echoed in the plan.
    pub scope_notes: Option<String>,
    /// Other tools the person uses, so the plan says what happens with them.
    pub other_apps: Vec<String>,
    /// Who sees what comes in from Notion, when the person chose; `None`
    /// keeps the planner's choice per item.
    pub notion_sharing: Option<NotionSharing>,
}
