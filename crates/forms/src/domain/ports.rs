//! Ports between the forms service and its adapters, and the service's own
//! contract. Every method of the service takes the receipt proving the
//! caller's access; the service decides everything beyond it.

use chrono::{DateTime, Utc};
use databases::domain::models::Viewer;
use entity_access::domain::models::{
    AccessLevel, EditAccessLevel, EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::{
    Audience, DatabaseId, ForbiddenWidget, Form, FormDetail, FormError, FormId, FormLayout,
    FormResponse, FormResponseId, FormSectionId, FormTally, FormUpdate, LayoutReplacement,
    ListedForm, MyResponse, RecordedResponse, ResponseCounts, ResponseSummary, RowId, StoredForm,
    Submission, SubmissionOutcome, TableId, UpdateForm,
};

/// Where a new form's responses go, with the access the caller proved.
#[derive(Debug, Clone)]
pub enum CreateSource {
    /// A new database for the caller.
    NewDatabase,
    /// An existing table of the database the receipt names. Attaching a
    /// form to an existing table takes the database's Owner: the form's
    /// editors gain Edit on the database through it, which only the
    /// database's owner may hand out.
    Table {
        /// Owner on the table's database.
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        /// The table.
        table_id: TableId,
    },
}

/// Create a form for a caller.
#[derive(Debug, Clone)]
pub struct CreateFormCommand {
    /// Its name.
    pub name: String,
    /// Where its responses go.
    pub source: CreateSource,
}

/// The current time, so closing times and ledger stamps are testable.
pub trait Clock: Send + Sync + 'static {
    /// Now.
    fn now(&self) -> DateTime<Utc>;
}

/// Which forms a user reaches through grants, as `entity_access` answers
/// it: the boundary of the forms catalog. Public forms the user holds no
/// grant on are not reached this way.
pub trait FormAccessDirectory: Send + Sync + 'static {
    /// The error type returned by directory operations.
    type Error: std::error::Error + Send + Sync + 'static;

    /// Every live form the user holds a grant on, at the highest level.
    fn accessible_forms(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<(FormId, AccessLevel)>, Self::Error>> + Send;
}

/// Liveness: tell the form's open pages it changed, so each re-reads what it
/// shows under its own access. The ping names the form and nothing else.
pub trait FormEventPublisher: Send + Sync + 'static {
    /// The error type returned by the publisher.
    type Error: std::error::Error + Send + Sync + 'static;

    /// Announce that the form's facts, layout or responses changed.
    fn form_changed(&self, form: FormId) -> impl Future<Output = Result<(), Self::Error>> + Send;
}

/// Persistence of forms, their layouts and the submission ledger.
pub trait FormsRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Error: std::error::Error + Send + Sync + 'static;

    /// Store a new form with its layout, granting its owner owner access,
    /// all or nothing. `name_follows_database` records, for good, that the
    /// form created its own database and goes by that database's name; the
    /// stored name is then only what it was called at creation.
    fn create_form(
        &self,
        form: &Form,
        layout: &FormLayout,
        name_follows_database: bool,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send;

    /// A form, trashed or not, if it exists.
    fn form(
        &self,
        id: FormId,
    ) -> impl Future<Output = Result<Option<StoredForm>, Self::Error>> + Send;

    /// The forms of these ids that are not in the trash; missing ids are
    /// left out.
    fn forms_by_ids(
        &self,
        ids: &[FormId],
    ) -> impl Future<Output = Result<Vec<Form>, Self::Error>> + Send;

    /// Those of `ids` that go by their database's name, trashed or not.
    fn forms_with_database_names(
        &self,
        ids: &[FormId],
    ) -> impl Future<Output = Result<Vec<FormId>, Self::Error>> + Send;

    /// The forms over a database that are not in the trash, oldest first.
    fn forms_for_database(
        &self,
        database_id: DatabaseId,
    ) -> impl Future<Output = Result<Vec<Form>, Self::Error>> + Send;

    /// A form's layout: its sections and questions in order.
    fn layout(&self, id: FormId) -> impl Future<Output = Result<FormLayout, Self::Error>> + Send;

    /// Replace a live form's layout as a whole, stamping `updated_at`, all
    /// or nothing. With `required_audience`, the write goes through only if
    /// the form has that audience when it commits; concurrent writes of the
    /// form's facts and layout serialize, so the check holds. A section or
    /// question id another form uses refuses the write.
    fn replace_layout(
        &self,
        id: FormId,
        layout: &FormLayout,
        updated_at: DateTime<Utc>,
        required_audience: Option<Audience>,
    ) -> impl Future<Output = Result<LayoutReplacement, Self::Error>> + Send;

    /// Change a live form's facts as `update` says, stamping `updated_at`;
    /// what it leaves out stays. With `forbidden_widget`, the change goes
    /// through only if no question of the form asks one of its columns with
    /// its widget when it commits; concurrent writes of the form's facts and
    /// layout serialize, so the check holds.
    fn update_form(
        &self,
        id: FormId,
        update: &UpdateForm,
        updated_at: DateTime<Utc>,
        forbidden_widget: Option<ForbiddenWidget>,
    ) -> impl Future<Output = Result<FormUpdate, Self::Error>> + Send;

    /// Rename a live form; `None` when it is gone or trashed.
    fn rename_form(
        &self,
        id: FormId,
        name: &str,
        updated_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<Option<Form>, Self::Error>> + Send;

    /// Stamp a live form's `updated_at` and nothing else, for a change of
    /// the form kept elsewhere (its database's name); `None` when it is
    /// gone or trashed.
    fn touch_form(
        &self,
        id: FormId,
        updated_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<Option<Form>, Self::Error>> + Send;

    /// Move a form to the trash; `false` when it is gone.
    fn trash_form(
        &self,
        id: FormId,
        trashed_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Error>> + Send;

    /// Bring a form back from the trash; `false` when it is gone.
    fn restore_form(&self, id: FormId) -> impl Future<Output = Result<bool, Self::Error>> + Send;

    /// Remove a form, its layout, ledger and grants.
    fn delete_form(&self, id: FormId) -> impl Future<Output = Result<(), Self::Error>> + Send;

    /// A signed-in respondent's ledger entry, if any.
    fn response_of(
        &self,
        form: FormId,
        respondent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<FormResponse>, Self::Error>> + Send;

    /// Record that a gate stopped a signed-in respondent: their entry
    /// becomes (or stays) a stop at `section`, unless it holds an accepted
    /// response, which is kept as it is.
    fn record_stop(
        &self,
        form: FormId,
        respondent: &MacroUserIdStr<'_>,
        section: FormSectionId,
        at: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send;

    /// Record a response whose row is written: a new entry for an anonymous
    /// respondent; for a signed-in one, their entry on the one-per-person
    /// key, replacing a stop. When that key already holds an accepted
    /// response the entry is left alone and this answers
    /// [`RecordedResponse::AlreadySubmitted`].
    fn record_submission(
        &self,
        form: FormId,
        respondent: Option<&MacroUserIdStr<'_>>,
        row: RowId,
        at: DateTime<Utc>,
    ) -> impl Future<Output = Result<RecordedResponse, Self::Error>> + Send;

    /// Point an entry at a new row, for a response whose row was deleted
    /// and written again.
    fn repoint_response(
        &self,
        response: FormResponseId,
        row: RowId,
        at: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send;

    /// Stamp an entry whose answers were edited.
    fn touch_response(
        &self,
        response: FormResponseId,
        at: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send;

    /// A form's ledger counts.
    fn response_counts(
        &self,
        form: FormId,
    ) -> impl Future<Output = Result<ResponseCounts, Self::Error>> + Send;
}

/// The forms domain service.
pub trait FormsService: Send + Sync + 'static {
    /// Initialize the editor-only Loro surface and publish its latest valid
    /// layout. Invalid drafts remain editable and return a publication error.
    fn collaborate_form(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> impl Future<Output = Result<models_forms::FormCollaboration, FormError>> + Send;

    /// Create a form over a new database or an existing table.
    fn create_form(
        &self,
        creator: Viewer,
        command: CreateFormCommand,
    ) -> impl Future<Output = Result<FormDetail, FormError>> + Send;

    /// Every live form the viewer holds a grant on, with their level, newest
    /// first. Public forms reached only by link are not listed.
    fn accessible_forms(
        &self,
        viewer: Viewer,
    ) -> impl Future<Output = Result<Vec<ListedForm>, FormError>> + Send;

    /// The live forms over the receipt's database.
    fn forms_for_database(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<Vec<Form>, FormError>> + Send;

    /// A form with its layout, each question joined with its column.
    fn get_form(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<FormDetail, FormError>> + Send;

    /// Change a form's facts; who responds, its status, closing time and
    /// tallies take its owner.
    fn update_form(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        update: UpdateForm,
    ) -> impl Future<Output = Result<Form, FormError>> + Send;

    /// Replace a form's layout as a whole, validated against its table.
    fn put_layout(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        layout: FormLayout,
    ) -> impl Future<Output = Result<FormDetail, FormError>> + Send;

    /// Respond: validate, run the gates, write the row, record the response.
    fn submit_response(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        submission: Submission,
    ) -> impl Future<Output = Result<SubmissionOutcome, FormError>> + Send;

    /// The signed-in caller's own response, with the row's current cells.
    fn my_response(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<MyResponse, FormError>> + Send;

    /// Replace the signed-in caller's answers while the form is open.
    fn edit_my_response(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        submission: Submission,
    ) -> impl Future<Output = Result<SubmissionOutcome, FormError>> + Send;

    /// Response counts for the form's editors.
    fn response_summary(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> impl Future<Output = Result<ResponseSummary, FormError>> + Send;

    /// Option counts of the form's choice questions: for respondents when
    /// the owner shows them, for editors always.
    fn tally(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<FormTally, FormError>> + Send;

    /// Rename a form. A form that created its own database goes by that
    /// database's name, so renaming it renames the database; a form over an
    /// existing table keeps a name of its own.
    fn rename_form(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        name: String,
    ) -> impl Future<Output = Result<Form, FormError>> + Send;

    /// Move a form to the trash. Its database stays.
    fn trash_form(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<(), FormError>> + Send;

    /// Bring a form back from the trash.
    fn restore_form(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<(), FormError>> + Send;

    /// Remove a form and its ledger for good. Its database and rows stay.
    fn delete_form_permanently(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<(), FormError>> + Send;
}
