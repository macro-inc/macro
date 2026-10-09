//! Authoritative workflows over Forms, Databases and authorized Scheduling ports.
mod access;
mod create;
mod edit;
mod read;
use super::{
    ports::{
        AuthoringAccess, AuthoringBooking, AuthoringCore, AuthoringEditor, FormsAuthoringService,
    },
    *,
};
use databases::domain::{
    models::{OpBatch, Viewer},
    ports::DatabasesService,
};
use entity_access::domain::models::{
    EditAccessLevel, Entity, EntityAccessReceipt, EntityType, OwnerAccessLevel, RequiredPermission,
    ViewAccessLevel,
};
use models_databases::{ColumnChange, DatabaseOp, NewColumn, NewOption};
use models_forms::{FormAccess, FormId, FormLayout};
use std::sync::Arc;

/// Dependencies supplied by the composition root. Permissions are checked on every call.
pub struct AuthoringWorkflow<Core, Databases, Booking, Access, Editor> {
    /// Authoritative shared Forms document.
    pub core: Arc<Core>,
    /// Owning service for schema mutations.
    pub databases: Arc<Databases>,
    /// Scheduling readiness and access validation.
    pub booking: Booking,
    /// Existing entity authorization boundary.
    pub access: Access,
    /// Shared worker that generates collaborative edit deltas.
    pub editor: Editor,
    /// Public app origin for canonical links.
    pub app_origin: String,
}
fn failure(error: impl std::fmt::Display) -> AuthoringError {
    AuthoringError::new(Code::Unavailable, "form", error.to_string())
}
pub(crate) fn form_failure(error: crate::domain::models::FormError) -> AuthoringError {
    error.into()
}
fn stale(path: &str) -> AuthoringError {
    AuthoringError::new(
        Code::ConcurrentFieldChange,
        path,
        "This field or dependency changed. ReadForm and revise the intended change.",
    )
}
fn entity(id: impl ToString, entity_type: EntityType) -> Entity {
    Entity {
        entity_id: id.to_string(),
        entity_type,
    }
}
fn managed(snapshot: &Snapshot) -> Vec<models_databases::ColumnId> {
    snapshot
        .form
        .submitted_column_id
        .into_iter()
        .chain(snapshot.form.respondent_column_id)
        .collect()
}

impl<
    C: AuthoringCore,
    D: DatabasesService,
    B: AuthoringBooking,
    A: AuthoringAccess,
    E: AuthoringEditor,
> AuthoringWorkflow<C, D, B, A, E>
{
    async fn receipt<L: RequiredPermission>(
        &self,
        actor: &Viewer,
        form: FormId,
    ) -> Result<EntityAccessReceipt<L>, AuthoringError> {
        self.access
            .receipt(actor, entity(form, EntityType::Form))
            .await
    }
    async fn targets(&self, actor: &Viewer, layout: &FormLayout) -> Result<(), AuthoringError> {
        for section in &layout.sections {
            if let models_forms::FormSection::Booking { target, .. } = section {
                self.booking.check_target(actor, target).await?;
            }
        }
        Ok(())
    }
    fn result(form_id: FormId, keys: KeyMap) -> MutationResult {
        MutationResult {
            form_id,
            keys,
            state: MutationState::PartiallyApplied,
            saved: None,
            diagnostics: vec![],
        }
    }
    fn outcome(
        &self,
        mut outcome: MutationResult,
        result: Result<Snapshot, AuthoringError>,
    ) -> MutationResult {
        match result {
            Ok(snapshot) => {
                let state = if snapshot.projected {
                    MutationState::Completed
                } else {
                    MutationState::SavedPendingProjection
                };
                outcome.saved = Some(self.saved(snapshot));
                outcome.state = state;
            }
            Err(error) => outcome.diagnostics.push(error.into()),
        }
        outcome
    }
    fn saved(&self, snapshot: Snapshot) -> SavedForm {
        let id = snapshot.form.id;
        SavedForm {
            accepting_responses: snapshot.form.accepts_responses_at(chrono::Utc::now()),
            form: snapshot.form,
            layout: snapshot.layout,
            columns: snapshot.columns,
            projected: snapshot.projected,
            editor_url: self.editor_url(id),
            respondent_url: self.respondent_url(id),
            capabilities: Capabilities {
                presentation_labels: false,
                conditional_column_cleanup: false,
                safe_linked_type_changes: false,
                required_booking_qualification: false,
            },
        }
    }
    fn editor_url(&self, id: FormId) -> String {
        format!("{}/app/form/{id}", self.app_origin.trim_end_matches('/'))
    }
    fn respondent_url(&self, id: FormId) -> String {
        format!(
            "{}/app/form/{id}/respond",
            self.app_origin.trim_end_matches('/')
        )
    }
    async fn schema(
        &self,
        viewer: Viewer,
        snapshot: &Snapshot,
        added: &[Column],
    ) -> Result<(), AuthoringError> {
        if added.is_empty() {
            return Ok(());
        }
        let ops = added
            .iter()
            .map(|c| DatabaseOp::Column {
                table: snapshot.form.table_id,
                column: c.id,
                change: ColumnChange::Create {
                    definition: NewColumn::New {
                        name: c.name.clone(),
                        kind: c.kind,
                        options: c
                            .options
                            .iter()
                            .map(|o| NewOption {
                                id: o.id,
                                label: o.label.clone(),
                            })
                            .collect(),
                        infer_type: false,
                    },
                    after: None,
                },
            })
            .collect();
        self.databases
            .apply_ops(
                self.access
                    .receipt::<EditAccessLevel>(
                        &viewer,
                        entity(snapshot.form.database_id, EntityType::Database),
                    )
                    .await?,
                viewer,
                OpBatch {
                    ops,
                    base_versions: [(
                        snapshot.form.table_id,
                        models_databases::TableVersion(snapshot.table_version),
                    )]
                    .into(),
                },
            )
            .await
            .map_err(failure)?;
        Ok(())
    }
}
