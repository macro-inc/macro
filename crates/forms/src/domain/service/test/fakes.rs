//! In-memory fakes for every port, over one shared world the tests inspect.

pub(crate) mod databases;
mod drafts;
pub(crate) use drafts::FakeDrafts;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use entity_access::domain::models::AccessLevel;
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel as ShareAccessLevel;
use models_permissions::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission, UpdateOperation,
};

use crate::domain::models::{
    Audience, ColumnId, DatabaseId, ForbiddenWidget, Form, FormId, FormLayout, FormResponse,
    FormResponseId, FormSection, FormSectionId, FormUpdate, LayoutReplacement, RecordedResponse,
    ResponseCounts, ResponseStatus, RowId, StoredForm, UpdateForm, Widget,
};
use crate::domain::ports::{Clock, FormAccessDirectory, FormEventPublisher, FormsRepo};
use crate::domain::sharing::FormSharingRepo;

pub(crate) use self::databases::{
    FakeColumn, FakeDatabase, FakeDatabases, FakeTable, GridChange, RecordedBatch,
    RecordedDatabaseRename,
};

#[derive(Debug, thiserror::Error)]
#[error("fake failure")]
pub(crate) struct FakeError;

/// One ledger entry, with who it belongs to.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LedgerEntry {
    pub(crate) response: FormResponse,
    pub(crate) respondent: Option<String>,
}

/// Shared mutable world the fakes read and write.
pub(crate) struct World {
    pub(crate) now: DateTime<Utc>,
    pub(crate) forms: Vec<StoredForm>,
    pub(crate) layouts: HashMap<FormId, FormLayout>,
    pub(crate) drafts: HashMap<FormId, Vec<u8>>,
    pub(crate) draft_states: HashMap<FormId, crate::domain::drafts::LayoutDraftState>,
    pub(crate) retired_drafts: Vec<FormId>,
    pub(crate) fail_drafts: bool,
    /// Owner grants the repository wrote with each new form.
    pub(crate) owner_grants: Vec<(FormId, String)>,
    pub(crate) ledger: Vec<LedgerEntry>,
    pub(crate) channel_grants: HashMap<FormId, Vec<ChannelSharePermission>>,
    /// Every form a liveness ping named, oldest first.
    pub(crate) form_pings: Vec<FormId>,
    /// Fail every liveness ping.
    pub(crate) fail_form_pings: bool,
    /// Fail every grant lookup of the forms catalog.
    pub(crate) fail_form_grants: bool,
    /// Each user's grants on forms, as `entity_access` would answer them.
    pub(crate) form_grants: HashMap<String, Vec<(FormId, AccessLevel)>>,
    /// Fail the next ledger write, after the row is written.
    pub(crate) fail_next_ledger_write: bool,
    pub(crate) databases: Vec<FakeDatabase>,
    /// Every database the service created: its name and owner.
    pub(crate) created_databases: Vec<(String, String)>,
    /// Every database the service purged.
    pub(crate) purged_databases: Vec<DatabaseId>,
    /// Every batch the service applied, refused ones included.
    pub(crate) batches: Vec<RecordedBatch>,
    /// A concurrent change of the form's audience that commits just before
    /// the next layout write.
    pub(crate) audience_before_next_layout_write: Option<Audience>,
    /// A concurrent layout put that commits just before the next change of
    /// the form's facts.
    pub(crate) layout_before_next_update: Option<FormLayout>,
    /// A concurrent submission by this person to this form that commits
    /// its ledger entry while the next batch is being written.
    pub(crate) competing_submission: Option<(FormId, String)>,
    /// A grid change that commits just before the next cell read.
    pub(crate) grid_change_before_next_cell_read: Option<GridChange>,
    /// Refuse the next batch with this error.
    pub(crate) adopt_new_database_before_next_batch: bool,
    pub(crate) refuse_next_batch: Option<::databases::domain::models::DatabaseError>,
    /// Every database rename the service asked for, refused ones included.
    pub(crate) database_renames: Vec<RecordedDatabaseRename>,
    /// Refuse the next database rename with this error.
    pub(crate) refuse_next_database_rename: Option<::databases::domain::models::DatabaseError>,
    /// Fail every read of a database's own facts.
    pub(crate) fail_database_metadata_reads: bool,
    /// How many times the service read a database's own facts.
    pub(crate) database_metadata_reads: usize,
    /// Every `macro.forms` envelope the service handed the broker.
    pub(crate) events: Vec<serde_json::Value>,
}

impl World {
    pub(crate) fn new(now: DateTime<Utc>) -> Self {
        Self {
            now,
            forms: vec![],
            layouts: HashMap::new(),
            drafts: HashMap::new(),
            draft_states: HashMap::new(),
            retired_drafts: vec![],
            fail_drafts: false,
            owner_grants: vec![],
            ledger: vec![],
            channel_grants: HashMap::new(),
            form_grants: HashMap::new(),
            form_pings: vec![],
            fail_form_pings: false,
            fail_form_grants: false,
            fail_next_ledger_write: false,
            databases: vec![],
            created_databases: vec![],
            purged_databases: vec![],
            batches: vec![],
            audience_before_next_layout_write: None,
            layout_before_next_update: None,
            competing_submission: None,
            grid_change_before_next_cell_read: None,
            adopt_new_database_before_next_batch: false,
            refuse_next_batch: None,
            database_renames: vec![],
            refuse_next_database_rename: None,
            fail_database_metadata_reads: false,
            database_metadata_reads: 0,
            events: vec![],
        }
    }

    /// The event types published, oldest first.
    pub(crate) fn event_types(&self) -> Vec<String> {
        self.events
            .iter()
            .map(|event| event["event_type"].as_str().unwrap_or_default().to_string())
            .collect()
    }

    pub(crate) fn database(&self, id: DatabaseId) -> &FakeDatabase {
        self.databases
            .iter()
            .find(|database| database.id == id)
            .expect("the database exists")
    }

    pub(crate) fn database_mut(&mut self, id: DatabaseId) -> &mut FakeDatabase {
        self.databases
            .iter_mut()
            .find(|database| database.id == id)
            .expect("the database exists")
    }
}

pub(crate) type Shared = Arc<Mutex<World>>;

/// The forms repository over the shared world.
#[derive(Clone)]
pub(crate) struct FakeRepo(pub(crate) Shared);

/// The grants the world holds on forms.
#[derive(Clone)]
pub(crate) struct FakeAccess(pub(crate) Shared);

impl FormAccessDirectory for FakeAccess {
    type Error = FakeError;

    async fn accessible_forms(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> Result<Vec<(FormId, AccessLevel)>, FakeError> {
        let world = self.0.lock().unwrap();
        if world.fail_form_grants {
            return Err(FakeError);
        }
        Ok(world
            .form_grants
            .get(user.as_ref())
            .cloned()
            .unwrap_or_default())
    }
}

/// Records each form a liveness ping named, and fails when told to.
#[derive(Clone)]
pub(crate) struct RecordingFormEvents(pub(crate) Shared);

impl FormEventPublisher for RecordingFormEvents {
    type Error = FakeError;

    async fn form_changed(&self, form: FormId) -> Result<(), FakeError> {
        let mut world = self.0.lock().unwrap();
        if world.fail_form_pings {
            return Err(FakeError);
        }
        world.form_pings.push(form);
        Ok(())
    }
}

/// The clock the world's `now` sets.
#[derive(Clone)]
pub(crate) struct FixedClock(pub(crate) Shared);

impl Clock for FixedClock {
    fn now(&self) -> DateTime<Utc> {
        self.0.lock().unwrap().now
    }
}

/// Records every event the service publishes.
#[derive(Clone)]
pub(crate) struct RecordingBroker(pub(crate) Shared);

impl MacroEventBroker for RecordingBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        let envelope =
            serde_json::to_value(event.event()).map_err(EventBrokerError::Serialization)?;
        self.0.lock().unwrap().events.push(envelope);
        Ok(tokio::spawn(async { Ok(()) }))
    }
}

/// Every section and question id of a layout.
fn layout_ids(layout: &FormLayout) -> Vec<uuid::Uuid> {
    layout
        .sections
        .iter()
        .flat_map(|section| {
            let questions = match section {
                FormSection::Questions { questions, .. } => questions
                    .iter()
                    .map(|question| question.id.into_uuid())
                    .collect(),
                FormSection::Gate { .. } | FormSection::Booking { .. } => vec![],
            };
            std::iter::once(section.id().into_uuid()).chain(questions)
        })
        .collect()
}

/// Every widget a layout's questions name, with the question's column.
fn layout_widgets(layout: &FormLayout) -> Vec<(ColumnId, Widget)> {
    layout
        .sections
        .iter()
        .flat_map(|section| match section {
            FormSection::Questions { questions, .. } => questions
                .iter()
                .filter_map(|question| question.widget.map(|widget| (question.column, widget)))
                .collect(),
            FormSection::Gate { .. } | FormSection::Booking { .. } => vec![],
        })
        .collect()
}

fn live(world: &World, id: FormId) -> Option<usize> {
    world
        .forms
        .iter()
        .position(|stored| stored.form.id == id && stored.trashed_at.is_none())
}

fn ledger_write(world: &mut World) -> Result<(), FakeError> {
    if world.fail_next_ledger_write {
        world.fail_next_ledger_write = false;
        return Err(FakeError);
    }
    Ok(())
}

fn replace_layout_locked(
    world: &mut World,
    id: FormId,
    layout: &FormLayout,
    updated_at: DateTime<Utc>,
    required_audience: Option<Audience>,
) -> Result<LayoutReplacement, FakeError> {
    let Some(position) = live(world, id) else {
        return Ok(LayoutReplacement::FormGone);
    };
    if let Some(audience) = world.audience_before_next_layout_write.take() {
        world.forms[position].form.audience = audience;
    }
    let others: Vec<uuid::Uuid> = world
        .layouts
        .iter()
        .filter(|(form, _)| **form != id)
        .flat_map(|(_, layout)| layout_ids(layout))
        .collect();
    if let Some(taken) = layout_ids(layout)
        .into_iter()
        .find(|id| others.contains(id))
    {
        return Ok(LayoutReplacement::IdTaken(taken));
    }
    if required_audience.is_some_and(|audience| world.forms[position].form.audience != audience) {
        return Ok(LayoutReplacement::AudienceChanged);
    }
    world.forms[position].form.updated_at = updated_at;
    world.layouts.insert(id, layout.clone());
    Ok(LayoutReplacement::Replaced)
}

impl FormsRepo for FakeRepo {
    type Error = FakeError;

    async fn create_form(
        &self,
        form: &Form,
        layout: &FormLayout,
        name_follows_database: bool,
    ) -> Result<crate::domain::models::FormCreation, FakeError> {
        let mut world = self.0.lock().unwrap();
        if world
            .forms
            .iter()
            .any(|stored| stored.form.table_id == form.table_id)
        {
            return Ok(crate::domain::models::FormCreation::TableOccupied);
        }
        world.forms.push(StoredForm {
            form: form.clone(),
            trashed_at: None,
            name_follows_database,
        });
        world.layouts.insert(form.id, layout.clone());
        world.owner_grants.push((form.id, form.owner_id.clone()));
        Ok(crate::domain::models::FormCreation::Created)
    }

    async fn table_has_form(
        &self,
        table: crate::domain::models::TableId,
    ) -> Result<bool, FakeError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .forms
            .iter()
            .any(|stored| stored.form.table_id == table))
    }

    async fn form(&self, id: FormId) -> Result<Option<StoredForm>, FakeError> {
        let world = self.0.lock().unwrap();
        Ok(world
            .forms
            .iter()
            .find(|stored| stored.form.id == id)
            .cloned())
    }

    async fn forms_by_ids(&self, ids: &[FormId]) -> Result<Vec<Form>, FakeError> {
        let world = self.0.lock().unwrap();
        Ok(world
            .forms
            .iter()
            .filter(|stored| ids.contains(&stored.form.id) && stored.trashed_at.is_none())
            .map(|stored| stored.form.clone())
            .collect())
    }

    async fn forms_with_database_names(&self, ids: &[FormId]) -> Result<Vec<FormId>, FakeError> {
        let world = self.0.lock().unwrap();
        Ok(world
            .forms
            .iter()
            .filter(|stored| ids.contains(&stored.form.id) && stored.name_follows_database)
            .map(|stored| stored.form.id)
            .collect())
    }

    async fn forms_for_database(&self, database_id: DatabaseId) -> Result<Vec<Form>, FakeError> {
        let world = self.0.lock().unwrap();
        Ok(world
            .forms
            .iter()
            .filter(|stored| stored.form.database_id == database_id && stored.trashed_at.is_none())
            .map(|stored| stored.form.clone())
            .collect())
    }

    async fn layout(&self, id: FormId) -> Result<FormLayout, FakeError> {
        let world = self.0.lock().unwrap();
        Ok(world
            .layouts
            .get(&id)
            .cloned()
            .unwrap_or(FormLayout { sections: vec![] }))
    }

    async fn replace_layout(
        &self,
        id: FormId,
        layout: &FormLayout,
        updated_at: DateTime<Utc>,
        required_audience: Option<Audience>,
    ) -> Result<LayoutReplacement, FakeError> {
        let mut world = self.0.lock().unwrap();
        if world
            .draft_states
            .get(&id)
            .is_some_and(|state| state.enabled)
        {
            return Ok(LayoutReplacement::DraftRequired);
        }
        replace_layout_locked(&mut world, id, layout, updated_at, required_audience)
    }

    async fn update_form(
        &self,
        id: FormId,
        changes: &UpdateForm,
        updated_at: DateTime<Utc>,
        forbidden_widget: Option<ForbiddenWidget>,
    ) -> Result<FormUpdate, FakeError> {
        let mut world = self.0.lock().unwrap();
        let Some(position) = live(&world, id) else {
            return Ok(FormUpdate::FormGone);
        };
        if let Some(layout) = world.layout_before_next_update.take() {
            world.layouts.insert(id, layout);
        }
        if let Some(forbidden) = forbidden_widget
            && world.layouts.get(&id).is_some_and(|layout| {
                layout_widgets(layout).into_iter().any(|(column, widget)| {
                    widget == forbidden.widget && forbidden.columns.contains(&column)
                })
            })
        {
            return Ok(FormUpdate::WidgetInUse);
        }
        let form = &mut world.forms[position].form;
        if let Some(description) = &changes.description {
            form.description = description.clone();
        }
        if let Some(message) = &changes.confirmation_message {
            form.confirmation_message = message.clone();
        }
        if let Some(audience) = changes.audience {
            form.audience = audience;
        }
        if let Some(status) = changes.status {
            form.status = status;
        }
        if let Some(closes_at) = changes.closes_at {
            form.closes_at = closes_at;
        }
        if let Some(tally_visible) = changes.tally_visible {
            form.tally_visible = tally_visible;
        }
        form.updated_at = updated_at;
        Ok(FormUpdate::Updated(Box::new(form.clone())))
    }

    async fn rename_form(
        &self,
        id: FormId,
        name: &str,
        updated_at: DateTime<Utc>,
    ) -> Result<Option<Form>, FakeError> {
        let mut world = self.0.lock().unwrap();
        let Some(position) = live(&world, id) else {
            return Ok(None);
        };
        let form = &mut world.forms[position].form;
        form.name = name.to_string();
        form.updated_at = updated_at;
        Ok(Some(form.clone()))
    }

    async fn touch_form(
        &self,
        id: FormId,
        updated_at: DateTime<Utc>,
    ) -> Result<Option<Form>, FakeError> {
        let mut world = self.0.lock().unwrap();
        let Some(position) = live(&world, id) else {
            return Ok(None);
        };
        let form = &mut world.forms[position].form;
        form.updated_at = updated_at;
        Ok(Some(form.clone()))
    }

    async fn trash_form(&self, id: FormId, trashed_at: DateTime<Utc>) -> Result<bool, FakeError> {
        let mut world = self.0.lock().unwrap();
        Ok(
            match world.forms.iter_mut().find(|stored| stored.form.id == id) {
                Some(stored) => {
                    stored.trashed_at = Some(trashed_at);
                    true
                }
                None => false,
            },
        )
    }

    async fn restore_form(&self, id: FormId) -> Result<bool, FakeError> {
        let mut world = self.0.lock().unwrap();
        Ok(
            match world.forms.iter_mut().find(|stored| stored.form.id == id) {
                Some(stored) => {
                    stored.trashed_at = None;
                    true
                }
                None => false,
            },
        )
    }

    async fn delete_form(&self, id: FormId) -> Result<(), FakeError> {
        let mut world = self.0.lock().unwrap();
        world.forms.retain(|stored| stored.form.id != id);
        world.layouts.remove(&id);
        world.ledger.retain(|entry| entry.response.form_id != id);
        world.owner_grants.retain(|(form, _)| *form != id);
        world.channel_grants.remove(&id);
        Ok(())
    }

    async fn response_of(
        &self,
        form: FormId,
        respondent: &MacroUserIdStr<'_>,
    ) -> Result<Option<FormResponse>, FakeError> {
        let world = self.0.lock().unwrap();
        Ok(world
            .ledger
            .iter()
            .find(|entry| {
                entry.response.form_id == form
                    && entry.respondent.as_deref() == Some(respondent.as_ref())
            })
            .map(|entry| entry.response.clone()))
    }

    async fn record_stop(
        &self,
        form: FormId,
        respondent: &MacroUserIdStr<'_>,
        section: FormSectionId,
        at: DateTime<Utc>,
    ) -> Result<(), FakeError> {
        let mut world = self.0.lock().unwrap();
        ledger_write(&mut world)?;
        let existing = world.ledger.iter_mut().find(|entry| {
            entry.response.form_id == form
                && entry.respondent.as_deref() == Some(respondent.as_ref())
        });
        match existing {
            Some(entry) if entry.response.status == ResponseStatus::Submitted => {}
            Some(entry) => {
                entry.response.stopped_at_section = Some(section);
                entry.response.updated_at = at;
            }
            None => {
                world.ledger.push(LedgerEntry {
                    response: FormResponse {
                        id: FormResponseId::new(),
                        form_id: form,
                        status: ResponseStatus::Stopped,
                        stopped_at_section: Some(section),
                        row: None,
                        submitted_at: at,
                        updated_at: at,
                    },
                    respondent: Some(respondent.to_string()),
                });
            }
        }
        Ok(())
    }

    async fn record_submission(
        &self,
        form: FormId,
        respondent: Option<&MacroUserIdStr<'_>>,
        row: RowId,
        at: DateTime<Utc>,
    ) -> Result<RecordedResponse, FakeError> {
        let mut world = self.0.lock().unwrap();
        ledger_write(&mut world)?;
        if let Some(respondent) = respondent
            && let Some(entry) = world.ledger.iter_mut().find(|entry| {
                entry.response.form_id == form
                    && entry.respondent.as_deref() == Some(respondent.as_ref())
            })
        {
            if entry.response.status == ResponseStatus::Submitted {
                return Ok(RecordedResponse::AlreadySubmitted);
            }
            entry.response = FormResponse {
                id: entry.response.id,
                form_id: form,
                status: ResponseStatus::Submitted,
                stopped_at_section: None,
                row: Some(row),
                submitted_at: at,
                updated_at: at,
            };
            return Ok(RecordedResponse::Recorded(entry.response.clone()));
        }
        let response = FormResponse {
            id: FormResponseId::new(),
            form_id: form,
            status: ResponseStatus::Submitted,
            stopped_at_section: None,
            row: Some(row),
            submitted_at: at,
            updated_at: at,
        };
        world.ledger.push(LedgerEntry {
            response: response.clone(),
            respondent: respondent.map(|respondent| respondent.to_string()),
        });
        Ok(RecordedResponse::Recorded(response))
    }

    async fn repoint_response(
        &self,
        response: FormResponseId,
        row: RowId,
        at: DateTime<Utc>,
    ) -> Result<(), FakeError> {
        let mut world = self.0.lock().unwrap();
        ledger_write(&mut world)?;
        let entry = world
            .ledger
            .iter_mut()
            .find(|entry| entry.response.id == response)
            .ok_or(FakeError)?;
        entry.response.row = Some(row);
        entry.response.updated_at = at;
        Ok(())
    }

    async fn touch_response(
        &self,
        response: FormResponseId,
        at: DateTime<Utc>,
    ) -> Result<(), FakeError> {
        let mut world = self.0.lock().unwrap();
        if let Some(entry) = world
            .ledger
            .iter_mut()
            .find(|entry| entry.response.id == response)
        {
            entry.response.updated_at = at;
        }
        Ok(())
    }

    async fn response_counts(&self, form: FormId) -> Result<ResponseCounts, FakeError> {
        let world = self.0.lock().unwrap();
        let mut counts = ResponseCounts::default();
        let mut stopped: HashMap<FormSectionId, u64> = HashMap::new();
        for entry in world
            .ledger
            .iter()
            .filter(|entry| entry.response.form_id == form)
        {
            match (entry.response.status, entry.response.stopped_at_section) {
                (ResponseStatus::Submitted, _) => counts.submitted += 1,
                (ResponseStatus::Stopped, Some(section)) => {
                    *stopped.entry(section).or_default() += 1
                }
                (ResponseStatus::Stopped, None) => {}
            }
        }
        counts.stopped_by_section = stopped.into_iter().collect();
        Ok(counts)
    }
}

impl FormSharingRepo for FakeRepo {
    type Error = FakeError;

    async fn channel_grants(
        &self,
        form_id: FormId,
    ) -> Result<Vec<ChannelSharePermission>, FakeError> {
        let world = self.0.lock().unwrap();
        Ok(world
            .channel_grants
            .get(&form_id)
            .cloned()
            .unwrap_or_default())
    }

    async fn update_channel_grants(
        &self,
        form_id: FormId,
        grants: &[UpdateChannelSharePermission],
    ) -> Result<bool, FakeError> {
        let mut world = self.0.lock().unwrap();
        if live(&world, form_id).is_none() {
            return Ok(false);
        }
        let current = world.channel_grants.entry(form_id).or_default();
        for grant in grants {
            current.retain(|existing| existing.channel_id != grant.channel_id);
            if grant.operation != UpdateOperation::Remove {
                current.push(ChannelSharePermission {
                    channel_id: grant.channel_id.clone(),
                    access_level: grant.access_level.unwrap_or(ShareAccessLevel::View),
                });
            }
        }
        Ok(true)
    }
}
