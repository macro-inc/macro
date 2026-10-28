//! What a form is called. A form that created its own database goes by that
//! database's name: every read asks the databases domain for it, and a
//! rename renames the database. A form over an existing table keeps a name
//! of its own.

use crate::domain::drafts::{FormDraftRepository, FormDraftStore};

use std::collections::{HashMap, HashSet};

use databases::domain::models::DatabaseError;
use databases::domain::ports::{DatabaseMetadataReads, DatabaseRowReads, DatabasesService};
use entity_access::domain::models::{
    AccessLevel, EditAccessLevel, Entity, EntityAccessReceipt, EntityPermission, EntityType,
    ViewAccessLevel,
};
use macro_event_broker::MacroEventBroker;

use super::{FormsServiceImpl, database_error, internal_receipt, repository_error};
use crate::domain::models::{DatabaseId, Form, FormError, FormId};
use crate::domain::ports::{Clock, FormAccessDirectory, FormEventPublisher, FormsRepo};

/// The receipt a form's editor renames its database with: Edit on a live
/// form grants Edit on its database, so the caller's own auth acts there
/// and the databases domain attributes the rename to them.
fn database_edit_receipt(
    receipt: &EntityAccessReceipt<EditAccessLevel>,
    database_id: DatabaseId,
) -> Result<EntityAccessReceipt<EditAccessLevel>, FormError> {
    EntityAccessReceipt::try_new(
        receipt.auth().clone(),
        Entity {
            entity_id: database_id.to_string(),
            entity_type: EntityType::Database,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .map_err(|_| FormError::NotFound)
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
    /// The name of the database a form goes by, in the trash or not. A
    /// database's forms are removed with it, so a missing one breaks the
    /// databases contract.
    async fn database_name(&self, database_id: DatabaseId) -> Result<String, FormError> {
        match self
            .databases
            .database_metadata(internal_receipt::<ViewAccessLevel>(database_id))
            .await
        {
            Ok(database) => Ok(database.name),
            Err(DatabaseError::NotFound) => Err(FormError::DatabaseContract(
                "a form outlived the database it is named by",
            )),
            Err(error) => Err(database_error(error)),
        }
    }

    /// `form` under the name it goes by.
    pub(super) async fn named(
        &self,
        form: Form,
        name_follows_database: bool,
    ) -> Result<Form, FormError> {
        if !name_follows_database {
            return Ok(form);
        }
        let name = self.database_name(form.database_id).await?;
        Ok(Form { name, ..form })
    }

    /// `forms` under the names they go by, reading each database's name
    /// once however many of them follow it.
    pub(super) async fn named_forms(&self, forms: Vec<Form>) -> Result<Vec<Form>, FormError> {
        let ids: Vec<FormId> = forms.iter().map(|form| form.id).collect();
        let following: HashSet<FormId> = self
            .repository
            .forms_with_database_names(&ids)
            .await
            .map_err(repository_error)?
            .into_iter()
            .collect();
        let mut database_names: HashMap<DatabaseId, String> = HashMap::new();
        let mut named = Vec::with_capacity(forms.len());
        for form in forms {
            if !following.contains(&form.id) {
                named.push(form);
                continue;
            }
            let name = match database_names.get(&form.database_id) {
                Some(name) => name.clone(),
                None => {
                    let name = self.database_name(form.database_id).await?;
                    database_names.insert(form.database_id, name.clone());
                    name
                }
            };
            named.push(Form { name, ..form });
        }
        Ok(named)
    }

    /// Rename the database `form` goes by as the caller, answering the name
    /// it took. A database in the trash is not renamed: restore it first.
    pub(super) async fn rename_database_of(
        &self,
        receipt: &EntityAccessReceipt<EditAccessLevel>,
        form: &Form,
        name: String,
    ) -> Result<String, FormError> {
        let database = self
            .databases
            .rename_database(database_edit_receipt(receipt, form.database_id)?, name)
            .await
            .map_err(|error| match error {
                DatabaseError::NotFound => FormError::TableGone,
                other => database_error(other),
            })?;
        Ok(database.name)
    }
}
