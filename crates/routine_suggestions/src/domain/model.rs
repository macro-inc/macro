//! Routine suggestions as the API returns and the database stores them.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// The view sidebars that show routine suggestions; each suggestion belongs to
/// exactly one.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    ToSchema,
    strum::Display,
    strum::EnumString,
    strum::EnumIter,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum RoutineSurface {
    /// Email.
    Email,
    /// Calendar.
    Calendar,
    /// Tasks.
    Tasks,
    /// Files and documents.
    Files,
    /// CRM companies, contacts, and pipelines.
    Crm,
    /// Channels.
    Chat,
    /// Calls.
    Calls,
    /// Pull request reviews.
    Reviews,
    /// Cross-workspace agents.
    Agents,
}

impl RoutineSurface {
    /// What a generation should automate on this surface.
    pub fn focus(self) -> &'static str {
        match self {
            Self::Email => {
                "Email: labeling and sorting incoming mail by what it is, flagging mail from important senders or about important topics, drafting replies, nudging the user about unanswered threads, and daily inbox digests."
            }
            Self::Calendar => {
                "Calendar: meeting prep briefs, daily agenda summaries, protecting focus time, and follow-ups for upcoming events."
            }
            Self::Tasks => {
                "Tasks: creating follow-up tasks after calls, turning emailed requests into tasks, weekly task reviews, and nudges for overdue or stalled work."
            }
            Self::Files => {
                "Files and documents: summarizing new documents, filing documents into projects, keeping recurring reports and notes up to date, and weekly document digests."
            }
            Self::Crm => {
                "CRM: adding companies and contacts from email and calls, keeping pipeline stages accurate, double checking that every entry is in the right pipeline position, and flagging deals that went quiet."
            }
            Self::Chat => {
                "Chat and channels: daily channel digests, surfacing questions that need the user, and posting regular updates."
            }
            Self::Calls => {
                "Calls: summarizing calls, extracting action items, creating follow-up tasks and emails at the end of every call, and logging call outcomes to the CRM."
            }
            Self::Reviews => {
                "Pull request reviews: daily digests of pull requests waiting on the user, reminders for stale reviews, and release summaries. Suggest these only when the inbox shows the user works with code; otherwise return none for this surface."
            }
            Self::Agents => {
                "Agents: cross-workspace automations that do not fit one surface, such as a morning briefing, a weekly review of priorities, research on a schedule, and end-of-week reports."
            }
        }
    }
}

/// The glyph a suggestion shows.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    ToSchema,
    strum::Display,
    strum::EnumString,
    strum::EnumIter,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum SuggestionIcon {
    /// Envelope.
    Mail,
    /// Label.
    Tag,
    /// Notification bell.
    Bell,
    /// Calendar.
    Calendar,
    /// Checkbox.
    Task,
    /// Page.
    Document,
    /// Chart.
    Chart,
    /// People.
    People,
    /// Phone.
    Phone,
    /// Code brackets.
    Code,
    /// Speech bubble.
    Chat,
    /// Sparkle; the fallback for an unknown icon.
    Sparkle,
}

/// Workspace-wide events a suggestion may start from. Events scoped to
/// specific channels, documents, or tasks are left out: they need the user to
/// pick those first.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    ToSchema,
    strum::Display,
    strum::EnumString,
    strum::EnumIter,
)]
pub enum SuggestedEvent {
    /// A new email arrives.
    #[serde(rename = "email.message_received")]
    #[strum(serialize = "email.message_received")]
    EmailMessageReceived,
    /// A task is created.
    #[serde(rename = "task.created")]
    #[strum(serialize = "task.created")]
    TaskCreated,
    /// A document is created.
    #[serde(rename = "document.created")]
    #[strum(serialize = "document.created")]
    DocumentCreated,
    /// A call starts.
    #[serde(rename = "call.started")]
    #[strum(serialize = "call.started")]
    CallStarted,
    /// A call ends.
    #[serde(rename = "call.ended")]
    #[strum(serialize = "call.ended")]
    CallEnded,
}

/// A day of the week, as weekly schedules name them.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    ToSchema,
    strum::Display,
    strum::EnumString,
    strum::EnumIter,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case", ascii_case_insensitive)]
pub enum Weekday {
    /// Sunday.
    Sun,
    /// Monday.
    Mon,
    /// Tuesday.
    Tue,
    /// Wednesday.
    Wed,
    /// Thursday.
    Thu,
    /// Friday.
    Fri,
    /// Saturday.
    Sat,
}

/// A 24-hour local time of day, `HH:MM`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(try_from = "String", into = "String")]
#[schema(value_type = String, example = "08:30")]
pub struct ClockTime(String);

/// The text is not a 24-hour `HH:MM` time.
#[derive(Debug, thiserror::Error)]
#[error("not a 24-hour HH:MM time")]
pub struct InvalidClockTime;

impl TryFrom<String> for ClockTime {
    type Error = InvalidClockTime;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        chrono::NaiveTime::parse_from_str(&value, "%H:%M").map_err(|_| InvalidClockTime)?;
        // `%H` also accepts one digit; the routine composer needs two.
        if value.len() != "HH:MM".len() {
            return Err(InvalidClockTime);
        }
        Ok(Self(value))
    }
}

impl From<ClockTime> for String {
    fn from(time: ClockTime) -> Self {
        time.0
    }
}

impl ClockTime {
    /// The time as `HH:MM`.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// How often a scheduled suggestion runs, in the user's time zone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "frequency", rename_all = "camelCase")]
pub enum SuggestionSchedule {
    /// At the top of every hour.
    Hour,
    /// Every day at `time`.
    Day {
        /// Local time of day.
        time: ClockTime,
    },
    /// On `weekdays` at `time`.
    #[serde(rename_all = "camelCase")]
    Week {
        /// Local time of day.
        time: ClockTime,
        /// The days to run; never empty, never repeated.
        weekdays: Vec<Weekday>,
    },
    /// On `day_of_month` at `time`.
    #[serde(rename_all = "camelCase")]
    Month {
        /// Local time of day.
        time: ClockTime,
        /// 1-28, so it exists in every month.
        day_of_month: u8,
    },
}

/// When a suggested routine runs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SuggestionTrigger {
    /// When a workspace event happens.
    Event {
        /// The event.
        event: SuggestedEvent,
        /// A yes/no question the event must answer yes to before the routine
        /// runs, e.g. "Is this email an invoice or a receipt?".
        #[serde(default, skip_serializing_if = "Option::is_none")]
        condition: Option<String>,
    },
    /// On a schedule.
    Schedule {
        /// The schedule.
        schedule: SuggestionSchedule,
    },
}

/// One routine the AI suggests for a user, ready to enable as-is.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoutineSuggestion {
    /// The sidebar it belongs to.
    pub surface: RoutineSurface,
    /// Short imperative routine name.
    pub title: String,
    /// One sentence on what it does.
    pub summary: String,
    /// Why it fits this user.
    pub reason: String,
    /// What the routine agent follows on every run.
    pub instructions: String,
    /// The glyph to show.
    pub icon: SuggestionIcon,
    /// The model's estimate, 0-1, that the user keeps it once enabled for
    /// them unasked.
    pub keep_probability: f64,
    /// Sends, posts, shares, or changes what other people see.
    pub affects_others: bool,
    /// Whether every run should show in the user's Home.
    pub notify: bool,
    /// When it runs.
    pub trigger: SuggestionTrigger,
}

/// Where the user's suggestion set stands.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    ToSchema,
    strum::Display,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum SuggestionSetStatus {
    /// A generation is running; earlier suggestions, if any, stay visible.
    Generating,
    /// The latest generation finished.
    Ready,
    /// The latest generation failed; earlier suggestions, if any, stay
    /// visible.
    Failed,
}

/// A user's routine suggestions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoutineSuggestionSet {
    /// Where generation stands.
    pub status: SuggestionSetStatus,
    /// The latest generated suggestions, best first within each surface.
    pub suggestions: Vec<RoutineSuggestion>,
    /// When `suggestions` were generated; absent before the first one lands.
    pub generated_at: Option<DateTime<Utc>>,
}

impl RoutineSuggestionSet {
    /// The set before anything was ever generated for the user.
    pub fn empty(status: SuggestionSetStatus) -> Self {
        Self {
            status,
            suggestions: Vec::new(),
            generated_at: None,
        }
    }
}

/// The stored row behind a user's [`RoutineSuggestionSet`].
#[derive(Debug, Clone, PartialEq)]
pub struct StoredSuggestionSet {
    /// Where generation stands.
    pub status: SuggestionSetStatus,
    /// The latest generated suggestions.
    pub suggestions: Vec<RoutineSuggestion>,
    /// When the current (or last) generation started.
    pub started_at: DateTime<Utc>,
    /// When `suggestions` were generated.
    pub generated_at: Option<DateTime<Utc>>,
}

impl From<StoredSuggestionSet> for RoutineSuggestionSet {
    fn from(stored: StoredSuggestionSet) -> Self {
        Self {
            status: stored.status,
            suggestions: stored.suggestions,
            generated_at: stored.generated_at,
        }
    }
}

/// One message from the top of a user's inbox, as a generation reads it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct InboxMessage {
    /// The user's own address it arrived in.
    pub inbox: String,
    /// Sender display name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_name: Option<String>,
    /// Sender address.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_email: Option<String>,
    /// Recipient and copied addresses besides the inbox.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub others: Vec<String>,
    /// Subject line.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    /// The provider's short body preview.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
    /// When it arrived.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub received_at: Option<DateTime<Utc>>,
}
