//! Domain models: the stored form, the submission ledger's states, commands,
//! and the domain error.

use chrono::{DateTime, Utc};
use databases::domain::models::DatabaseError;
use macro_user_id::user_id::MacroUserIdStr;

pub use models_databases::{CellValue, ColumnId, DatabaseId, OptionId, RowId, TableId};
pub use models_forms::{
    Answer, Audience, CreateForm, Form, FormAccess, FormDetail, FormId, FormLayout,
    FormQuestionDetail, FormQuestionId, FormResponse, FormResponseId, FormSection,
    FormSectionDetail, FormSectionId, FormSource, FormStatus, FormTally, LayoutProblem, ListedForm,
    MyResponse, QuestionLayout, QuestionOption, QuestionTally, ResponseStatus, ResponseSummary,
    SectionCount, Submission, SubmissionOutcome, TallyBucket, TallyValue, UpdateForm, Widget,
};

/// A form as stored, with its trash state, which lifecycle operations read.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredForm {
    /// The form's facts. Its name is what it was called at creation when
    /// `name_follows_database`; the database's name is the form's then.
    pub form: Form,
    /// When it was trashed, if it is in the trash.
    pub trashed_at: Option<DateTime<Utc>>,
    /// Whether the form created its own database and goes by its name.
    pub name_follows_database: bool,
}

/// Who is responding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Respondent {
    /// A signed-in person: one response, editable, named in the Respondent
    /// column.
    Member(MacroUserIdStr<'static>),
    /// An anonymous visitor of a public form.
    Anonymous,
}

/// What recording a written response found.
#[derive(Debug, Clone, PartialEq)]
pub enum RecordedResponse {
    /// The ledger holds the response.
    Recorded(FormResponse),
    /// The signed-in respondent's one entry already holds an accepted
    /// response; nothing was recorded.
    AlreadySubmitted,
}

/// What replacing a form's layout came to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LayoutReplacement {
    /// This form's layout is now owned by its collaborative document.
    DraftRequired,
    /// The layout is the form's now.
    Replaced,
    /// The form is gone or in the trash; nothing was written.
    FormGone,
    /// The write required an audience the form no longer has when it
    /// committed; nothing was written.
    AudienceChanged,
    /// A section or question id of the layout belongs to another form;
    /// nothing was written.
    IdTaken(uuid::Uuid),
}

/// A widget a change of a form's facts may not leave in use: on any
/// question asking one of `columns`, the columns it still applies to under
/// the table's current types. A question keeping the widget on another
/// column is not asked that way any more and does not count.
///
/// `columns` is the domain's reading of the table's types, taken before the
/// write; the repository checks it atomically against the form's layout,
/// which writes of the layout serialize with. A column retyped in the grid
/// at that moment is not serialized with it (the databases domain owns that
/// write), so a File widget left on a column that becomes a link again can
/// stand on a public form. Presentation closes that gap: a public form never
/// asks for a file whatever its stored layout (`effective_widget`), and a
/// layout put refuses a file question on a public form.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForbiddenWidget {
    /// The widget.
    pub widget: Widget,
    /// The columns it applies to.
    pub columns: Vec<ColumnId>,
}

/// What changing a form's facts came to.
#[derive(Debug, Clone, PartialEq)]
pub enum FormUpdate {
    /// The form as changed.
    Updated(Box<Form>),
    /// The form is gone or in the trash; nothing was written.
    FormGone,
    /// The change forbade a widget one of the form's questions uses when it
    /// committed; nothing was written.
    WidgetInUse,
}

/// A form's ledger counts.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ResponseCounts {
    /// Entries submitted.
    pub submitted: u64,
    /// Entries stopped, by gate, in no particular order.
    pub stopped_by_section: Vec<(FormSectionId, u64)>,
}

/// Why a sharing change was refused.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SharingRefusal {
    /// Forms have no share link; their public audience is the form's own.
    #[error("forms are not shared by link; set the form's audience instead")]
    LinkShare,
    /// Forms have no team share.
    #[error("forms are not shared with a team")]
    TeamShare,
    /// Too many channel grants in one change.
    #[error("at most {max} channels may change at once")]
    TooManyChannels {
        /// The most allowed.
        max: usize,
    },
    /// A channel grant names a bad channel, repeats one, grants ownership
    /// or names no level.
    #[error("a channel grant is invalid")]
    InvalidChannelGrant,
}

/// Errors of the forms domain.
#[derive(Debug, thiserror::Error)]
pub enum FormError {
    /// The form, or something it names, does not exist or is not the
    /// caller's to see.
    #[error("not found")]
    NotFound,
    /// Only the form's owner may make the change.
    #[error("only the form's owner can change who responds, close it or show its tallies")]
    OwnerOnly,
    /// The form takes responses from signed-in members only.
    #[error("sign in to respond to this form")]
    SignInRequired,
    /// The form is closed or past its closing time.
    #[error("this form is closed")]
    Closed,
    /// The form's database is in the trash.
    #[error("the form's table is gone")]
    TableGone,
    /// The respondent already responded.
    #[error("you already responded; edit your response instead")]
    AlreadyResponded,
    /// The respondent has no saved response.
    #[error("you have no response to this form")]
    NoResponse,
    /// An answer names a question the form does not ask.
    #[error("the form has no question {question}")]
    UnknownQuestion {
        /// The question.
        question: FormQuestionId,
    },
    /// A question is answered twice.
    #[error("question {question} is answered twice")]
    RepeatedAnswer {
        /// The question.
        question: FormQuestionId,
    },
    /// A required question is unanswered.
    #[error("question {question} is required")]
    MissingAnswer {
        /// The question.
        question: FormQuestionId,
    },
    /// An answer does not fit its question's column.
    #[error("the answer to question {question} does not fit: {reason}")]
    InvalidAnswer {
        /// The question.
        question: FormQuestionId,
        /// Why.
        reason: String,
    },
    /// A question's widget does not fit its column.
    #[error("question {question} cannot be asked that way")]
    WidgetMismatch {
        /// The question.
        question: FormQuestionId,
    },
    /// File upload needs a signed-in respondent.
    #[error("file upload needs signed-in respondents, so a public form cannot ask for a file")]
    FileUploadNeedsSignIn,
    /// The layout does not fit the form's table.
    #[error("invalid layout: {0}")]
    InvalidLayout(LayoutProblem),
    /// A name is empty or too long.
    #[error("{0}")]
    InvalidName(&'static str),
    /// A sharing change was refused.
    #[error("invalid sharing change: {0}")]
    InvalidSharing(SharingRefusal),
    /// The owner keeps the form's tallies from respondents.
    #[error("this form's results are hidden")]
    TallyHidden,
    /// The table changed under the request.
    #[error("the table changed; try again")]
    Conflict,
    /// The databases service failed or refused in a way the form cannot
    /// explain.
    #[error("databases error: {0}")]
    Database(DatabaseError),
    /// The durable collaborative draft could not be read or saved.
    #[error("collaboration error: {0}")]
    Collaboration(rootcause::Report),
    /// Persistence failure.
    #[error("repository error: {0}")]
    Repository(rootcause::Report),
    /// The databases service answered something its contract rules out.
    #[error("databases contract violated: {0}")]
    DatabaseContract(&'static str),
    /// The grants behind the forms catalog could not be read.
    #[error("access directory error: {0}")]
    AccessDirectory(rootcause::Report),
}

impl From<LayoutProblem> for FormError {
    fn from(problem: LayoutProblem) -> Self {
        FormError::InvalidLayout(problem)
    }
}

impl From<SharingRefusal> for FormError {
    fn from(refusal: SharingRefusal) -> Self {
        FormError::InvalidSharing(refusal)
    }
}
