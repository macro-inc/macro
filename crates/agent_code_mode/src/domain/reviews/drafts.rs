//! Typed review drafts and outcomes. Decoding a draft is its validation.
use super::{ReviewItemStatus, ReviewKind};
use crate::domain::CodeModeError;
use macro_uuid::Uuid;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize, de::DeserializeOwned};

pub use calendar_events::inbound::toolset::{
    CreateCalendarEvent as CalendarDraft, EventTimeInput, ToolCalendarEvent as CalendarResult,
};
pub use email::inbound::toolset::{SendEmail as EmailDraft, SendEmailResponse as EmailResult};
pub use import::domain::models::NotionImportReport as ImportResult;

/// Most independent drafts one review may stack.
pub const MAX_DRAFTS: usize = 100;

/// A review stack label: not blank, at most 256 characters.
#[nutype::nutype(
    sanitize(trim),
    validate(not_empty, len_char_max = 256),
    derive(Debug, Clone, PartialEq, Eq, AsRef, Display, Serialize, Deserialize),
    derive_unchecked(JsonSchema, specta::Type)
)]
pub struct ReviewTitle(String);

/// One to [`MAX_DRAFTS`] drafts of one kind.
#[nutype::nutype(
    validate(predicate = |drafts| (1..=MAX_DRAFTS).contains(&drafts.len())),
    derive(Debug, Clone, AsRef, Serialize, Deserialize),
    derive_unchecked(JsonSchema, specta::Type)
)]
pub struct DraftList<Draft>(Vec<Draft>);

/// Which source's staged plan an import review presents.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum ImportReviewSource {
    /// A Notion workspace plan (`macro.imports.notion.plan()`).
    Notion,
    /// A Linear workspace plan (`macro.imports.linear.plan()`).
    Linear,
    /// A Jira workspace plan (`macro.imports.jira.plan()`).
    Jira,
}

impl From<ImportReviewSource> for import::domain::models::ImportSource {
    fn from(source: ImportReviewSource) -> Self {
        match source {
            ImportReviewSource::Notion => Self::Notion,
            ImportReviewSource::Linear => Self::Linear,
            ImportReviewSource::Jira => Self::Jira,
        }
    }
}

/// The one draft an import review carries: which source's staged plan it
/// presents, the plan rows the user took out of it, and the rows whose
/// sharing they changed: `shared` to share with their team, `personal` to
/// keep to themselves.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportDraft {
    /// The staged plan's source; fixed once the review is presented.
    pub source: ImportReviewSource,
    /// Plan rows left out of the import.
    #[serde(default)]
    pub excluded: Vec<Uuid>,
    /// Plan rows shared with the team although the plan keeps them private.
    #[serde(default)]
    pub shared: Vec<Uuid>,
    /// Plan rows kept private although the plan shares them.
    #[serde(default)]
    pub personal: Vec<Uuid>,
}

/// The drafts a new review presents, keyed by the review's kind.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, specta::Type)]
#[serde(tag = "kind", content = "drafts", rename_all = "snake_case")]
pub enum ReviewDrafts {
    /// Emails, each sent with the SendEmail action (Markdown body).
    Email(DraftList<EmailDraft>),
    /// Calendar events, each created with the CreateCalendarEvent action.
    Calendar(DraftList<CalendarDraft>),
    /// Exactly one staged import plan, approved as one item.
    Import([ImportDraft; 1]),
}

/// One replacement draft, keyed by the kind of the review it edits.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, specta::Type)]
#[serde(tag = "kind", content = "draft", rename_all = "snake_case")]
pub enum ReviewDraft {
    /// An edited email.
    Email(EmailDraft),
    /// An edited calendar event.
    Calendar(CalendarDraft),
    /// An edited import plan selection.
    Import(ImportDraft),
}

/// Item facts every kind shares.
#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReviewItemState {
    /// Stable item identity across stack navigation and edits.
    #[specta(type = String)]
    pub id: Uuid,
    /// Whether the account holder edited this draft before deciding.
    #[serde(default)]
    pub edited: bool,
    /// Current outcome.
    pub status: ReviewItemStatus,
    /// Failure or uncertainty description.
    pub error: Option<String>,
}

/// One editable item and its durable outcome.
#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReviewItem<Draft, Outcome> {
    /// Identity and status.
    #[serde(flatten)]
    pub state: ReviewItemState,
    /// Arguments for the existing composer and action.
    pub draft: Draft,
    /// The action's confirmed response, never a model assertion.
    pub result: Option<Outcome>,
}

impl<Draft, Outcome> ReviewItem<Draft, Outcome> {
    /// A new pending item.
    pub fn pending(draft: Draft) -> Self {
        Self {
            state: ReviewItemState {
                id: macro_uuid::generate_uuid_v7(),
                edited: false,
                status: ReviewItemStatus::Pending,
                error: None,
            },
            draft,
            result: None,
        }
    }
}

/// Saved items keyed by the review's kind.
#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", content = "items", rename_all = "snake_case")]
pub enum ReviewItems {
    /// Email drafts and their send responses.
    Email(Vec<ReviewItem<EmailDraft, EmailResult>>),
    /// Calendar drafts and their created events.
    Calendar(Vec<ReviewItem<CalendarDraft, CalendarResult>>),
    /// The import plan selection and the started write's report.
    Import(Box<[ReviewItem<ImportDraft, ImportResult>; 1]>),
}

/// A confirmed action response, keyed by kind.
pub enum ReviewResult {
    /// The email was sent.
    Email(EmailResult),
    /// The event was created.
    Calendar(CalendarResult),
    /// The import write started.
    Import(ImportResult),
}

impl From<ReviewDrafts> for ReviewItems {
    fn from(drafts: ReviewDrafts) -> Self {
        match drafts {
            ReviewDrafts::Email(drafts) => Self::Email(
                drafts
                    .into_inner()
                    .into_iter()
                    .map(ReviewItem::pending)
                    .collect(),
            ),
            ReviewDrafts::Calendar(drafts) => Self::Calendar(
                drafts
                    .into_inner()
                    .into_iter()
                    .map(ReviewItem::pending)
                    .collect(),
            ),
            ReviewDrafts::Import([draft]) => Self::Import(Box::new([ReviewItem::pending(draft)])),
        }
    }
}

impl ReviewDrafts {
    /// Whether every draft serializes within `limit` bytes.
    pub fn each_within(&self, limit: usize) -> bool {
        fn fits<Draft: Serialize>(drafts: &[Draft], limit: usize) -> bool {
            drafts
                .iter()
                .all(|draft| serde_json::to_vec(draft).is_ok_and(|bytes| bytes.len() <= limit))
        }
        match self {
            Self::Email(drafts) => fits(drafts.as_ref(), limit),
            Self::Calendar(drafts) => fits(drafts.as_ref(), limit),
            Self::Import(drafts) => fits(drafts, limit),
        }
    }

    /// The kind of review these drafts present.
    pub fn kind(&self) -> ReviewKind {
        match self {
            Self::Email(_) => ReviewKind::Email,
            Self::Calendar(_) => ReviewKind::Calendar,
            Self::Import(_) => ReviewKind::Import,
        }
    }
}

impl ReviewItems {
    /// The component and action used to finish these items.
    pub fn kind(&self) -> ReviewKind {
        match self {
            Self::Email(_) => ReviewKind::Email,
            Self::Calendar(_) => ReviewKind::Calendar,
            Self::Import(_) => ReviewKind::Import,
        }
    }

    /// Every item's shared facts, in stack order.
    pub fn states(&self) -> Vec<&ReviewItemState> {
        match self {
            Self::Email(items) => items.iter().map(|item| &item.state).collect(),
            Self::Calendar(items) => items.iter().map(|item| &item.state).collect(),
            Self::Import(items) => items.iter().map(|item| &item.state).collect(),
        }
    }

    /// Every item's shared facts, mutably, in stack order.
    pub fn states_mut(&mut self) -> Vec<&mut ReviewItemState> {
        match self {
            Self::Email(items) => items.iter_mut().map(|item| &mut item.state).collect(),
            Self::Calendar(items) => items.iter_mut().map(|item| &mut item.state).collect(),
            Self::Import(items) => items.iter_mut().map(|item| &mut item.state).collect(),
        }
    }

    /// Replace a pending item's draft with one of the same kind.
    pub fn edit(&mut self, item: Uuid, draft: ReviewDraft) -> Result<(), CodeModeError> {
        fn replace<Draft, Outcome>(
            items: &mut [ReviewItem<Draft, Outcome>],
            item: Uuid,
            draft: Draft,
        ) -> Result<(), CodeModeError> {
            let target = items
                .iter_mut()
                .find(|entry| {
                    entry.state.id == item && entry.state.status == ReviewItemStatus::Pending
                })
                .ok_or(CodeModeError::Conflict)?;
            target.draft = draft;
            target.state.edited = true;
            Ok(())
        }
        match (self, draft) {
            (Self::Email(items), ReviewDraft::Email(draft)) => replace(items, item, draft),
            (Self::Calendar(items), ReviewDraft::Calendar(draft)) => replace(items, item, draft),
            (Self::Import(items), ReviewDraft::Import(draft)) => {
                let [saved] = &**items;
                if saved.draft.source != draft.source {
                    return Err(CodeModeError::Invalid(
                        "An import review's source cannot change after presentation.".into(),
                    ));
                }
                replace(&mut items[..], item, draft)
            }
            _ => Err(CodeModeError::Invalid(
                "The draft's kind does not match the review's kind.".into(),
            )),
        }
    }

    /// Why the item at `index` cannot be acted on yet, if it cannot.
    pub fn submission_problem(&self, index: usize) -> Option<&'static str> {
        match self {
            Self::Email(items) => items.get(index).and_then(|item| email_problem(&item.draft)),
            Self::Calendar(items) => items
                .get(index)
                .and_then(|item| calendar_problem(&item.draft)),
            Self::Import(_) => None,
        }
    }

    /// Record a confirmed response on the item at `index`.
    pub fn complete(&mut self, index: usize, result: ReviewResult) -> Result<(), CodeModeError> {
        fn store<Draft, Outcome>(
            items: &mut [ReviewItem<Draft, Outcome>],
            index: usize,
            result: Outcome,
        ) -> Result<(), CodeModeError> {
            let item = items.get_mut(index).ok_or(CodeModeError::Conflict)?;
            item.state.status = ReviewItemStatus::Completed;
            item.result = Some(result);
            Ok(())
        }
        match (self, result) {
            (Self::Email(items), ReviewResult::Email(result)) => store(items, index, result),
            (Self::Calendar(items), ReviewResult::Calendar(result)) => store(items, index, result),
            (Self::Import(items), ReviewResult::Import(result)) => {
                store(&mut items[..], index, result)
            }
            _ => Err(CodeModeError::Invalid(
                "The action's response does not match the review's kind.".into(),
            )),
        }
    }
}

/// Whether an email draft can be sent. Incomplete drafts still save, so the
/// account holder can finish them in the card.
fn email_problem(draft: &EmailDraft) -> Option<&'static str> {
    if draft.to.is_empty() {
        return Some("Add at least one recipient.");
    }
    if draft.body.trim().is_empty() {
        return Some("Write a message before sending.");
    }
    None
}

/// Whether a calendar draft can be created. Incomplete drafts still save.
fn calendar_problem(draft: &CalendarDraft) -> Option<&'static str> {
    if draft.title.trim().is_empty() {
        return Some("Give this event a title.");
    }
    let ends_after_start = match &draft.time {
        EventTimeInput::Timed {
            starts_at, ends_at, ..
        } => ends_at > starts_at,
        EventTimeInput::AllDay {
            start_date,
            end_date,
        } => end_date > start_date,
    };
    if !ends_after_start {
        return Some("The event must end after it starts.");
    }
    if draft.add_macro_call && draft.add_conference {
        return Some("Choose either a Macro call or a video meeting.");
    }
    None
}

/// Decode JSON into a review type. Errors name only the failing location,
/// never the submitted content.
pub fn decode<Input: DeserializeOwned>(json: &[u8]) -> Result<Input, CodeModeError> {
    let mut deserializer = serde_json::Deserializer::from_slice(json);
    let input = serde_path_to_error::deserialize(&mut deserializer)
        .map_err(|error| CodeModeError::Invalid(format!("Invalid value at `{}`.", error.path())))?;
    deserializer
        .end()
        .map_err(|_| CodeModeError::Invalid("Unexpected content after the JSON value.".into()))?;
    Ok(input)
}
