//! The forms service: all authorization policy beyond receipt minting, and
//! every use case's orchestration, over its ports.

mod answers;
mod authoring;
mod create;
mod drafts;
mod layout;
mod lifecycle;
mod managed;
mod names;
mod responses;
mod sharing;
mod submit;
#[cfg(test)]
mod test;

use crate::domain::drafts::{FormDraftRepository, FormDraftStore};

use std::sync::Arc;

use databases::domain::models::{DatabaseError, TableDetail, Viewer};
use databases::domain::ports::{DatabaseMetadataReads, DatabaseRowReads, DatabasesService};
use entity_access::domain::models::{
    AccessLevel, EditAccessLevel, EntityAccessAuth, EntityAccessReceipt, EntityPermission,
    EntityType, OwnerAccessLevel, RequiredPermission, ViewAccessLevel,
};
use macro_event_broker::MacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::events::{self, FormMacroEvent, FormTopicEvent};
use crate::domain::models::{
    DatabaseId, Form, FormAccess, FormDetail, FormError, FormId, FormLayout, FormTally, ListedForm,
    MyResponse, Respondent, ResponseSummary, StoredForm, Submission, SubmissionOutcome, UpdateForm,
};
use crate::domain::ports::{
    Clock, CreateFormCommand, FormAccessDirectory, FormEventPublisher, FormsRepo, FormsService,
};

/// Concrete forms service backed by its ports. `Databases` is the databases
/// domain service, the only way a form reads or writes its table; `Access`
/// lists the forms a user holds grants on; `Events` pings a form's open
/// pages after it changes.
#[derive(Debug, Clone)]
pub struct FormsServiceImpl<Repository, Databases, Access, Events, Now, Broker, Drafts> {
    repository: Repository,
    databases: Arc<Databases>,
    access: Access,
    events: Events,
    clock: Now,
    broker: Broker,
    drafts: Drafts,
}

fn repository_error<Error: std::error::Error + Send + Sync + 'static>(error: Error) -> FormError {
    FormError::Repository(rootcause::Report::new(error).into_dynamic())
}

/// A databases failure the form has no better word for.
fn database_error(error: DatabaseError) -> FormError {
    match error {
        DatabaseError::VersionConflict => FormError::Conflict,
        other => FormError::Database(other),
    }
}

/// The form a receipt was minted for.
fn receipt_form_id<Level: RequiredPermission>(
    receipt: &EntityAccessReceipt<Level>,
) -> Result<FormId, FormError> {
    let entity = receipt.entity();
    if entity.entity_type != EntityType::Form {
        return Err(FormError::NotFound);
    }
    entity.entity_id.parse().map_err(|_| FormError::NotFound)
}

/// The database a receipt was minted for.
fn receipt_database_id<Level: RequiredPermission>(
    receipt: &EntityAccessReceipt<Level>,
) -> Result<DatabaseId, FormError> {
    let entity = receipt.entity();
    if entity.entity_type != EntityType::Database {
        return Err(FormError::NotFound);
    }
    entity.entity_id.parse().map_err(|_| FormError::NotFound)
}

/// The caller's level a receipt proves. Receipts minted for internal callers
/// carry the level their minting asserted.
fn receipt_access<Level: RequiredPermission>(receipt: &EntityAccessReceipt<Level>) -> FormAccess {
    access_of(match receipt.entity_permission() {
        EntityPermission::AccessLevel { access_level } => *access_level,
        _ => AccessLevel::View,
    })
}

/// A grant's level as a form names it: comment is view on a form.
fn access_of(level: AccessLevel) -> FormAccess {
    match level {
        AccessLevel::Owner => FormAccess::Owner,
        AccessLevel::Edit => FormAccess::Edit,
        AccessLevel::View | AccessLevel::Comment => FormAccess::View,
    }
}

/// Who a receipt says is acting, as events record it. Internal and
/// anonymous receipts have nobody to attribute the change to.
fn receipt_attribution<Level: RequiredPermission>(
    receipt: &EntityAccessReceipt<Level>,
) -> Option<events::Attribution> {
    match receipt.auth() {
        EntityAccessAuth::Authenticated(user) => Some(events::Attribution::user(user.clone())),
        EntityAccessAuth::Bot(bot) => Some(events::Attribution {
            actor: activity::Actor::new_from_bot(bot.bot_id()),
            on_behalf_of: bot.scope().acting_user_id().cloned(),
        }),
        EntityAccessAuth::Unauthenticated | EntityAccessAuth::Internal => None,
    }
}

/// Who is responding under a receipt: the signed-in person, or the agent's
/// user, or nobody.
fn receipt_respondent<Level: RequiredPermission>(
    receipt: &EntityAccessReceipt<Level>,
) -> Respondent {
    match receipt.acting_user_id() {
        Some(user) => Respondent::Member(user.clone()),
        None => Respondent::Anonymous,
    }
}

/// A form's owner, as the user its writes act for when nobody signed in.
fn owner_of(form: &Form) -> Result<MacroUserIdStr<'static>, FormError> {
    MacroUserIdStr::try_from(form.owner_id.clone()).map_err(|error| {
        FormError::Repository(rootcause::report!(
            "stored form owner is not a user id: {error}"
        ))
    })
}

/// The receipt the forms service acts on its table's database with: it has
/// already decided the caller may do what it is about to do.
fn internal_receipt<Level: RequiredPermission>(
    database_id: DatabaseId,
) -> EntityAccessReceipt<Level> {
    EntityAccessReceipt::dangerously_assert_internal_user(
        &database_id.to_string(),
        EntityType::Database,
    )
}

impl<Repository, Databases, Access, Events, Now, Broker, Drafts>
    FormsServiceImpl<Repository, Databases, Access, Events, Now, Broker, Drafts>
where
    Repository: FormsRepo + FormDraftRepository,
    Databases: DatabasesService + DatabaseRowReads + DatabaseMetadataReads,
    Access: FormAccessDirectory,
    Events: FormEventPublisher,
    Now: Clock,
    Broker: MacroEventBroker,
    Drafts: FormDraftStore,
{
    /// Create a forms service from its ports.
    pub fn new(
        repository: Repository,
        databases: Arc<Databases>,
        access: Access,
        events: Events,
        clock: Now,
        broker: Broker,
        drafts: Drafts,
    ) -> Self {
        Self {
            repository,
            databases,
            access,
            events,
            clock,
            broker,
            drafts,
        }
    }

    /// Publish one domain event. The change it describes already committed,
    /// so a broker failure is logged rather than surfaced.
    fn emit(&self, event: FormTopicEvent) {
        if let Err(error) = self.broker.send_event(&FormMacroEvent::new(event)) {
            tracing::warn!(error = ?error, "failed to publish form event");
        }
    }

    /// Now, to the microsecond, as a stored timestamp keeps it, so what a
    /// write answers equals what is read back.
    fn now(&self) -> chrono::DateTime<chrono::Utc> {
        use chrono::SubsecRound;
        self.clock.now().trunc_subsecs(6)
    }

    /// Tell the form's open pages it changed. The change already committed,
    /// so a failed ping is logged rather than surfaced; pages still read
    /// fresh on their next load.
    async fn announce(&self, form: FormId) {
        if let Err(error) = self.events.form_changed(form).await {
            tracing::warn!(error = ?error, form_id = %form, "failed to announce a form change");
        }
    }

    /// A form whatever its trash state; lifecycle operations act on trashed
    /// ones too.
    async fn stored_form(&self, id: FormId) -> Result<StoredForm, FormError> {
        self.repository
            .form(id)
            .await
            .map_err(repository_error)?
            .ok_or(FormError::NotFound)
    }

    /// A form that is not in the trash, as stored; a trashed one reads as
    /// missing.
    async fn live_stored_form(&self, id: FormId) -> Result<StoredForm, FormError> {
        let stored = self.stored_form(id).await?;
        if stored.trashed_at.is_some() {
            return Err(FormError::NotFound);
        }
        Ok(stored)
    }

    /// A form that is not in the trash, under the name it goes by.
    async fn live_form(&self, id: FormId) -> Result<Form, FormError> {
        let stored = self.live_stored_form(id).await?;
        self.named(stored.form, stored.name_follows_database).await
    }

    /// The form's table, read under the form's internal receipt; `None` when
    /// its database is in the trash or the table is gone.
    async fn table_of(&self, form: &Form) -> Result<Option<TableDetail>, FormError> {
        let detail = match self
            .databases
            .get_database(internal_receipt::<ViewAccessLevel>(form.database_id))
            .await
        {
            Ok(detail) => detail,
            Err(DatabaseError::NotFound) => return Ok(None),
            Err(error) => return Err(database_error(error)),
        };
        Ok(detail
            .tables
            .into_iter()
            .find(|table| table.table.id == form.table_id))
    }

    /// [`Self::table_of`], refusing a form whose table is gone.
    async fn live_table_of(&self, form: &Form) -> Result<TableDetail, FormError> {
        self.table_of(form).await?.ok_or(FormError::TableGone)
    }
}

/// Validate a one-line name: trimmed, nonempty, not too long.
fn validated_name(name: &str) -> Result<String, FormError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(FormError::InvalidName("a form needs a name"));
    }
    if trimmed.chars().count() > models_forms::MAX_TITLE_LENGTH {
        return Err(FormError::InvalidName("the name is too long"));
    }
    Ok(trimmed.to_string())
}

/// Refuse a text longer than `max` characters.
fn within(text: &str, max: usize) -> Result<(), FormError> {
    if text.chars().count() > max {
        return Err(FormError::InvalidLayout(
            models_forms::LayoutProblem::TextTooLong { max },
        ));
    }
    Ok(())
}

impl<Repository, Databases, Access, Events, Now, Broker, Drafts> FormsService
    for FormsServiceImpl<Repository, Databases, Access, Events, Now, Broker, Drafts>
where
    Repository: FormsRepo + FormDraftRepository,
    Databases: DatabasesService + DatabaseRowReads + DatabaseMetadataReads,
    Access: FormAccessDirectory,
    Events: FormEventPublisher,
    Now: Clock,
    Broker: MacroEventBroker,
    Drafts: FormDraftStore,
{
    async fn collaborate_form(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<models_forms::FormCollaboration, FormError> {
        self.collaborate(&receipt).await
    }

    #[tracing::instrument(skip(self, creator, command), err)]
    async fn create_form(
        &self,
        creator: Viewer,
        command: CreateFormCommand,
    ) -> Result<FormDetail, FormError> {
        self.create(creator, command).await
    }

    #[tracing::instrument(skip(self, viewer), err)]
    async fn accessible_forms(&self, viewer: Viewer) -> Result<Vec<ListedForm>, FormError> {
        self.catalog(&viewer).await
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn forms_for_database(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Vec<Form>, FormError> {
        let database_id = receipt_database_id(&receipt)?;
        let forms = self
            .repository
            .forms_for_database(database_id)
            .await
            .map_err(repository_error)?;
        self.named_forms(forms).await
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn get_form(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<FormDetail, FormError> {
        self.read_detail(&receipt).await
    }

    #[tracing::instrument(skip(self, receipt, update), err)]
    async fn update_form(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        update: UpdateForm,
    ) -> Result<Form, FormError> {
        self.change_facts(&receipt, update).await
    }

    #[tracing::instrument(skip(self, receipt, layout), err)]
    async fn put_layout(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        layout: FormLayout,
    ) -> Result<models_forms::FormCollaboration, FormError> {
        self.replace_layout(&receipt, layout).await
    }

    #[tracing::instrument(skip(self, receipt, submission), err)]
    async fn submit_response(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        submission: Submission,
    ) -> Result<SubmissionOutcome, FormError> {
        self.submit(&receipt, submission).await
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn my_response(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<MyResponse, FormError> {
        self.own_response(&receipt).await
    }

    #[tracing::instrument(skip(self, receipt, submission), err)]
    async fn edit_my_response(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        submission: Submission,
    ) -> Result<SubmissionOutcome, FormError> {
        self.edit(&receipt, submission).await
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn response_summary(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<ResponseSummary, FormError> {
        self.summary(&receipt).await
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn tally(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<FormTally, FormError> {
        self.count_choices(&receipt).await
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn rename_form(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        name: String,
    ) -> Result<Form, FormError> {
        self.rename(&receipt, &name).await
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn trash_form(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), FormError> {
        self.trash(&receipt).await
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn restore_form(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), FormError> {
        self.restore(&receipt).await
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn delete_form_permanently(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), FormError> {
        self.purge(&receipt).await
    }
}
