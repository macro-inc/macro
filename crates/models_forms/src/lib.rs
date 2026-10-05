#![deny(missing_docs)]
//! The wire types of Macro Forms: ids, the layout a form shows a table's
//! columns in, answers, submission outcomes, summaries and errors. A form is
//! a view of one database table, so answers are `models_databases` cells and
//! gate rules are `models_databases` filters.

mod collaboration;
mod detail;
mod error;
mod form;
mod ids;
mod layout;
mod response;
#[cfg(test)]
mod test;
mod widget;

pub use collaboration::FormCollaboration;
pub use detail::{FormDetail, FormQuestionDetail, FormSectionDetail, QuestionOption};
pub use error::{FormErrorCode, FormErrorResponse, LayoutProblem};
pub use form::{
    Audience, CreateForm, Form, FormAccess, FormSource, FormStatus, ListedForm, UpdateForm,
};
pub use ids::{
    BookingEventTypeId, BookingProfileId, FormId, FormQuestionId, FormResponseId, FormSectionId,
};
pub use layout::{BookingTarget, FormLayout, FormSection, FormSectionKind, QuestionLayout};
pub use response::{
    Answer, FormResponse, FormTally, MyResponse, QuestionTally, ResponseStatus, ResponseSummary,
    SectionCount, Submission, SubmissionOutcome, TallyBucket, TallyValue, UnlockedBooking,
};
pub use widget::Widget;

/// Longest form name, section title, or other one-line text.
pub const MAX_TITLE_LENGTH: usize = 200;
/// Longest description, help text, gate message or confirmation message.
pub const MAX_TEXT_LENGTH: usize = 10_000;
