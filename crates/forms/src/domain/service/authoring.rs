//! Authorized durable reads and exact-version writes used by Forms workflows.
use super::*;
use crate::domain::authoring::ports::AuthoringCore;
use crate::domain::authoring::{Column, Snapshot};
use crate::domain::collaboration;
use crate::domain::drafts::FormDraftError;
use crate::domain::ports::CreateSource;

impl<Repository, Databases, Access, Events, Now, Broker, Drafts> AuthoringCore
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
    async fn authoring_source(
        &self,
        source: &CreateSource,
    ) -> Result<(Vec<Column>, Vec<models_databases::ColumnId>), FormError> {
        let new_columns = || {
            vec![
                Column {
                    id: models_databases::ColumnId::new(),
                    name: create::SUBMITTED_COLUMN.into(),
                    kind: managed::submitted_kind(),
                    options: vec![],
                },
                Column {
                    id: models_databases::ColumnId::new(),
                    name: create::RESPONDENT_COLUMN.into(),
                    kind: managed::respondent_kind(),
                    options: vec![],
                },
            ]
        };
        match source {
            CreateSource::NewDatabase => {
                let columns = new_columns();
                let managed = columns.iter().map(|c| c.id).collect();
                Ok((columns, managed))
            }
            CreateSource::Table { receipt, table_id } => {
                receipt_database_id(receipt)?;
                let detail = self
                    .databases
                    .get_database(
                        receipt
                            .clone()
                            .try_into_requirement()
                            .map_err(|_| FormError::NotFound)?,
                    )
                    .await
                    .map_err(database_error)?;
                let table = detail
                    .tables
                    .iter()
                    .find(|table| table.table.id == *table_id)
                    .ok_or(FormError::NotFound)?;
                if self
                    .repository
                    .table_has_form(*table_id)
                    .await
                    .map_err(repository_error)?
                {
                    return Err(FormError::TableAlreadyHasForm);
                }
                let mut columns: Vec<Column> = layout::question_columns(table)
                    .into_iter()
                    .map(|(id, c)| Column {
                        id,
                        name: c.name,
                        kind: c.kind,
                        options: c.options,
                    })
                    .collect();
                let mut managed_ids = vec![];
                for column in new_columns() {
                    match create::managed_column(table, &column.name, column.kind) {
                        create::ManagedColumn::Existing(id) => managed_ids.push(id),
                        create::ManagedColumn::New { id, name } => {
                            managed_ids.push(id);
                            columns.push(Column { id, name, ..column });
                        }
                    }
                }
                Ok((columns, managed_ids))
            }
        }
    }

    async fn authoring_changed(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        sharing: bool,
    ) {
        if let Ok(id) = receipt_form_id(&receipt) {
            self.announce(id).await;
            if sharing {
                self.emit(crate::domain::events::FormTopicEvent::SharingChanged(
                    crate::domain::events::FormChangedMetadata {
                        form_id: id,
                        attribution: receipt_attribution(&receipt),
                    },
                ));
            }
        }
    }

    async fn create_private(
        &self,
        creator: Viewer,
        command: CreateFormCommand,
        id: FormId,
    ) -> Result<FormDetail, FormError> {
        self.create_with_identity(creator, command, id, create::CreationPolicy::Authoring)
            .await
    }

    async fn authoring_snapshot(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<Snapshot, FormError> {
        let form = self.live_form(receipt_form_id(&receipt)?).await?;
        let table = self.live_table_of(&form).await?;
        self.ensure_draft(&form).await?;
        let bytes = self
            .drafts
            .snapshot(form.id)
            .await
            .map_err(drafts::draft_error)?;
        let draft = collaboration::read_layout(&bytes)
            .map_err(|error| FormError::Collaboration(rootcause::report!(error).into_dynamic()))?;
        let refreshed = self.refresh_layout(&form, Some(&table)).await?;
        // A later read may have projected a newer version. Only mark this exact
        // snapshot current when both the durable and projected revisions agree.
        let state = self
            .repository
            .draft_state(form.id)
            .await
            .map_err(repository_error)?
            .ok_or(FormError::NotFound)?;
        let projected = refreshed.publication_error.is_none()
            && state
                .revision
                .as_deref()
                .map(|revision| collaboration::revision_matches(revision, &draft.revision))
                .transpose()
                .map_err(|error| {
                    FormError::Collaboration(rootcause::report!(error).into_dynamic())
                })?
                .unwrap_or(false);
        // Settings CAS uses the persisted representation; equivalent version maps
        // can encode in different orders when the durable draft is read again.
        let revision = state
            .revision
            .filter(|_| projected)
            .unwrap_or(draft.revision);
        let mut columns: Vec<Column> = layout::question_columns(&table)
            .into_iter()
            .map(|(id, c)| Column {
                id,
                name: c.name,
                kind: c.kind,
                options: c.options,
            })
            .collect();
        columns.sort_by_key(|column| column.id);
        Ok(Snapshot {
            form: self.live_form(form.id).await?,
            layout: draft.layout,
            document: bytes,
            revision,
            columns,
            table_version: table.table.version.0,
            projected,
            access: receipt_access(&receipt),
            grants: vec![],
        })
    }

    async fn apply_authoring_update(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        update: Vec<u8>,
    ) -> Result<Snapshot, crate::domain::authoring::AuthoringError> {
        let id = receipt_form_id(&receipt)?;
        // Human edits arriving after the AI's snapshot merge with the same CRDT
        // operations. CAS only ensures the validated candidate is the one saved.
        for _ in 0..3 {
            let form = self.live_form(id).await?;
            let table = self.live_table_of(&form).await?;
            let bytes = self
                .drafts
                .snapshot(id)
                .await
                .map_err(drafts::draft_error)?;
            let current = collaboration::read_layout(&bytes)
                .map_err(|e| FormError::Collaboration(rootcause::report!(e).into_dynamic()))?;
            let merged = collaboration::merged_layout(&bytes, &update)
                .map_err(|e| FormError::Collaboration(rootcause::report!(e).into_dynamic()))?;
            let columns: Vec<Column> = layout::question_columns(&table)
                .into_iter()
                .map(|(id, c)| Column {
                    id,
                    name: c.name,
                    kind: c.kind,
                    options: c.options,
                })
                .collect();
            let managed: Vec<_> = form
                .submitted_column_id
                .into_iter()
                .chain(form.respondent_column_id)
                .collect();
            crate::domain::authoring::validate::canonical_preserving(
                &merged.layout,
                &columns,
                &managed,
                form.audience,
                Some(&current.layout),
            )?;
            super::layout::validate_layout(&merged.layout, &form, &table)?;
            if let Some(id) = self
                .repository
                .conflicting_layout_id(form.id, &merged.layout)
                .await
                .map_err(repository_error)?
            {
                return Err(FormError::from(models_forms::LayoutProblem::RepeatedId { id }).into());
            }
            match self
                .drafts
                .update(id, current.revision, update.clone())
                .await
            {
                Ok(()) => return self.authoring_snapshot(receipt).await.map_err(Into::into),
                Err(FormDraftError::Conflict) => continue,
                Err(error) => return Err(drafts::draft_error(error).into()),
            }
        }
        Err(FormError::Conflict.into())
    }

    async fn save_authoring_layout(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        expected_revision: Vec<u8>,
        layout: FormLayout,
    ) -> Result<Snapshot, FormError> {
        let form = self.live_form(receipt_form_id(&receipt)?).await?;
        let table = self.live_table_of(&form).await?;
        super::layout::validate_layout(&layout, &form, &table)?;
        if let Some(id) = self
            .repository
            .conflicting_layout_id(form.id, &layout)
            .await
            .map_err(repository_error)?
        {
            return Err(models_forms::LayoutProblem::RepeatedId { id }.into());
        }
        self.ensure_draft(&form).await?;
        let bytes = self
            .drafts
            .snapshot(form.id)
            .await
            .map_err(drafts::draft_error)?;
        let change = collaboration::replace_layout(&bytes, &layout)
            .map_err(|error| FormError::Collaboration(rootcause::report!(error).into_dynamic()))?;
        if !collaboration::revision_matches(&change.expected_revision, &expected_revision)
            .map_err(|error| FormError::Collaboration(rootcause::report!(error).into_dynamic()))?
        {
            return Err(FormError::Conflict);
        }
        match self
            .drafts
            .update(form.id, expected_revision, change.update)
            .await
        {
            Ok(()) => {}
            Err(FormDraftError::Conflict) => return Err(FormError::Conflict),
            Err(error) => return Err(drafts::draft_error(error)),
        }
        // A failure here is an uncertain projection outcome, never a safe replay.
        self.authoring_snapshot(receipt).await
    }
}
