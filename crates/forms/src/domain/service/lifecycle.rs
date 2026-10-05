//! A form's facts and lifecycle: metadata changes, rename, trash, restore
//! and permanent deletion. None of them touch the form's database.

use std::collections::HashMap;

use databases::domain::models::Viewer;
use databases::domain::ports::{DatabaseRowReads, DatabasesService};
use entity_access::domain::models::{
    AccessLevel, EditAccessLevel, EntityAccessReceipt, OwnerAccessLevel,
};
use macro_event_broker::MacroEventBroker;
use models_forms::MAX_TEXT_LENGTH;

use super::layout::file_columns;
use super::{
    FormsServiceImpl, access_of, receipt_access, receipt_attribution, receipt_form_id,
    repository_error, validated_name, within,
};
use crate::domain::events::{
    FormChangedMetadata, FormPurgedMetadata, FormRenamedMetadata, FormTopicEvent,
};
use crate::domain::models::{
    Audience, ForbiddenWidget, Form, FormAccess, FormError, FormId, FormUpdate, ListedForm,
    UpdateForm, Widget,
};
use crate::domain::ports::{Clock, FormAccessDirectory, FormEventPublisher, FormsRepo};

impl<Repository, Databases, Access, Events, Now, Broker>
    FormsServiceImpl<Repository, Databases, Access, Events, Now, Broker>
where
    Repository: FormsRepo,
    Databases: DatabasesService + DatabaseRowReads,
    Access: FormAccessDirectory,
    Events: FormEventPublisher,
    Now: Clock,
    Broker: MacroEventBroker,
{
    /// The live forms the viewer holds a grant on, newest first, each with
    /// the viewer's level as the grants answer it.
    pub(super) async fn catalog(&self, viewer: &Viewer) -> Result<Vec<ListedForm>, FormError> {
        let grants: HashMap<FormId, AccessLevel> = self
            .access
            .accessible_forms(&viewer.user_id)
            .await
            .map_err(|error| {
                FormError::AccessDirectory(rootcause::Report::new(error).into_dynamic())
            })?
            .into_iter()
            .collect();
        let ids: Vec<FormId> = grants.keys().copied().collect();
        let mut forms = self
            .repository
            .forms_by_ids(&ids)
            .await
            .map_err(repository_error)?;
        forms.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        Ok(forms
            .into_iter()
            .filter_map(|form| {
                let access = access_of(*grants.get(&form.id)?);
                Some(ListedForm { form, access })
            })
            .collect())
    }

    pub(super) async fn change_facts(
        &self,
        receipt: &EntityAccessReceipt<EditAccessLevel>,
        update: UpdateForm,
    ) -> Result<Form, FormError> {
        let form = self.live_form(receipt_form_id(receipt)?).await?;
        if update.needs_owner() && receipt_access(receipt) < FormAccess::Owner {
            return Err(FormError::OwnerOnly);
        }
        for text in [&update.description, &update.confirmation_message]
            .into_iter()
            .flatten()
        {
            within(text, MAX_TEXT_LENGTH)?;
        }
        // A public form asks for no file: going public holds only if no
        // question asks for one when the change commits. A file widget left
        // on a column the grid retyped asks for nothing, so only the
        // table's current link columns count; a form whose table is gone
        // asks for nothing at all.
        let forbidden_widget = match update.audience {
            Some(Audience::Public) => Some(ForbiddenWidget {
                widget: Widget::File,
                columns: self
                    .table_of(&form)
                    .await?
                    .as_ref()
                    .map(file_columns)
                    .unwrap_or_default(),
            }),
            Some(Audience::Members) | None => None,
        };
        match self
            .repository
            .update_form(form.id, &update, self.now(), forbidden_widget)
            .await
            .map_err(repository_error)?
        {
            FormUpdate::Updated(form) => {
                self.announce(form.id).await;
                Ok(*form)
            }
            FormUpdate::FormGone => Err(FormError::NotFound),
            FormUpdate::WidgetInUse => Err(FormError::FileUploadNeedsSignIn),
        }
    }

    pub(super) async fn rename(
        &self,
        receipt: &EntityAccessReceipt<EditAccessLevel>,
        name: &str,
    ) -> Result<Form, FormError> {
        let form = self.live_form(receipt_form_id(receipt)?).await?;
        let name = validated_name(name)?;
        let renamed = self
            .repository
            .rename_form(form.id, &name, self.now())
            .await
            .map_err(repository_error)?
            .ok_or(FormError::NotFound)?;
        self.announce(form.id).await;
        self.emit(FormTopicEvent::Renamed(FormRenamedMetadata {
            form_id: form.id,
            attribution: receipt_attribution(receipt),
            name,
        }));
        Ok(renamed)
    }

    pub(super) async fn trash(
        &self,
        receipt: &EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), FormError> {
        let stored = self.stored_form(receipt_form_id(receipt)?).await?;
        if stored.trashed_at.is_some() {
            return Ok(());
        }
        if !self
            .repository
            .trash_form(stored.form.id, self.now())
            .await
            .map_err(repository_error)?
        {
            return Err(FormError::NotFound);
        }
        self.announce(stored.form.id).await;
        self.emit(FormTopicEvent::Trashed(FormChangedMetadata {
            form_id: stored.form.id,
            attribution: receipt_attribution(receipt),
        }));
        Ok(())
    }

    pub(super) async fn restore(
        &self,
        receipt: &EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), FormError> {
        let stored = self.stored_form(receipt_form_id(receipt)?).await?;
        if stored.trashed_at.is_none() {
            return Ok(());
        }
        if !self
            .repository
            .restore_form(stored.form.id)
            .await
            .map_err(repository_error)?
        {
            return Err(FormError::NotFound);
        }
        self.announce(stored.form.id).await;
        self.emit(FormTopicEvent::Restored(FormChangedMetadata {
            form_id: stored.form.id,
            attribution: receipt_attribution(receipt),
        }));
        Ok(())
    }

    pub(super) async fn purge(
        &self,
        receipt: &EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), FormError> {
        let stored = self.stored_form(receipt_form_id(receipt)?).await?;
        self.repository
            .delete_form(stored.form.id)
            .await
            .map_err(repository_error)?;
        self.announce(stored.form.id).await;
        self.emit(FormTopicEvent::Purged(FormPurgedMetadata {
            form_id: stored.form.id,
        }));
        Ok(())
    }
}
