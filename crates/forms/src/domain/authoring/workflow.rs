//! Authoritative workflows over Forms, Databases and authorized Scheduling ports.
mod access;
mod create;
mod edit;
mod read;
use super::{
    journal::{AuthoringJournal, Claim, Intent, Operation},
    ports::{AuthoringAccess, AuthoringBooking, AuthoringCore, FormsAuthoringService},
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
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::{ColumnChange, DatabaseOp, NewColumn, NewOption};
use models_forms::{FormAccess, FormId, FormLayout};
use std::sync::Arc;

/// Dependencies supplied by the composition root. Permissions are checked on every call.
pub struct AuthoringWorkflow<Core, Databases, Journal, Booking, Access> {
    /// Authoritative shared Forms document.
    pub core: Arc<Core>,
    /// Owning service for schema mutations.
    pub databases: Arc<Databases>,
    /// Actor-scoped durable retries and revisions.
    pub journal: Journal,
    /// Scheduling readiness and access validation.
    pub booking: Booking,
    /// Existing entity authorization boundary.
    pub access: Access,
    /// Public app origin for canonical links.
    pub app_origin: String,
}
fn failure(error: impl std::fmt::Display) -> AuthoringError {
    AuthoringError::new(Code::Unavailable, "form", error.to_string())
}
fn form_failure(error: crate::domain::models::FormError) -> AuthoringError {
    use crate::domain::models::FormError;
    let code = match &error {
        FormError::Conflict => Code::ConcurrentFieldChange,
        FormError::NotFound | FormError::TableGone => Code::FormNotFound,
        FormError::TableAlreadyHasForm => Code::TableAlreadyHasForm,
        FormError::OwnerOnly | FormError::SignInRequired => Code::Forbidden,
        FormError::InvalidName(_) => Code::InvalidName,
        FormError::InvalidLayout(_) | FormError::WidgetMismatch { .. } => Code::InvalidDraft,
        FormError::FileUploadNeedsSignIn | FormError::InvalidSharing(_) => Code::InvalidAccess,
        _ => Code::Unavailable,
    };
    AuthoringError::new(code, "form", error.to_string())
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
    J: AuthoringJournal,
    B: AuthoringBooking,
    A: AuthoringAccess,
> AuthoringWorkflow<C, D, J, B, A>
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
    fn operation(
        intent: Intent,
        form_id: FormId,
        prepared: Option<validate::Prepared>,
    ) -> Operation {
        // Request and operation occupy separate typed domains, but share a stable
        // UUID so lookup never requires a second client-provided retry identity.
        let operation_id = AuthoringOperationId::from_uuid(intent.request_id().into_uuid());
        let keys = prepared
            .as_ref()
            .map(|p| p.keys.clone())
            .unwrap_or_default();
        Operation {
            intent,
            prepared,
            result: MutationResult {
                operation_id,
                form_id,
                keys,
                state: MutationState::Pending,
                phase: OperationPhase::Reserved,
                saved: None,
                diagnostics: vec![],
            },
        }
    }
    async fn phase(
        &self,
        actor: &Viewer,
        operation: &mut Operation,
        phase: OperationPhase,
    ) -> Result<(), AuthoringError> {
        operation.result.phase = phase;
        self.journal.save(&actor.user_id, operation).await
    }
    async fn outcome(
        &self,
        actor: &Viewer,
        mut operation: Operation,
        result: Result<Snapshot, AuthoringError>,
    ) -> Result<MutationResult, AuthoringError> {
        match result {
            Ok(snapshot) => {
                operation.result.state = if snapshot.projected {
                    MutationState::Completed
                } else {
                    MutationState::SavedPendingProjection
                };
                match self.saved(&actor.user_id, snapshot).await {
                    Ok(saved) => {
                        operation.result.saved = Some(saved);
                        operation.result.phase = OperationPhase::Completed;
                    }
                    Err(error) => {
                        operation.result.state = MutationState::PartiallyApplied;
                        operation.result.diagnostics.push(error.into());
                    }
                }
            }
            Err(error) => {
                operation.result.state = MutationState::PartiallyApplied;
                operation.result.diagnostics.push(error.into());
            }
        }
        if let Err(error) = self.journal.save(&actor.user_id, &operation).await {
            operation.result.state = MutationState::PartiallyApplied;
            operation.result.diagnostics.push(error.into());
        }
        Ok(operation.result)
    }
    async fn inspect(
        &self,
        actor: &Viewer,
        operation: Operation,
        snapshot: &Snapshot,
    ) -> Result<MutationResult, AuthoringError> {
        let mut result = operation.result;
        if !matches!(result.state, MutationState::Completed) {
            let postconditions = operation.prepared.as_ref().is_some_and(|p| {
                p.layout == snapshot.layout
                    && p.columns.iter().all(|c| snapshot.columns.contains(c))
            }) && match &operation.intent {
                Intent::Create(i) => {
                    snapshot.form.description == i.draft.description
                        && snapshot.form.confirmation_message == i.draft.confirmation_message
                }
                Intent::Edit(i) => {
                    i.description
                        .as_ref()
                        .is_none_or(|v| *v == snapshot.form.description)
                        && i.confirmation_message
                            .as_ref()
                            .is_none_or(|v| *v == snapshot.form.confirmation_message)
                }
                Intent::Access(_) => false,
            };
            if result.phase == OperationPhase::SettingsApplied || postconditions {
                result.state = if snapshot.projected {
                    MutationState::Completed
                } else {
                    MutationState::SavedPendingProjection
                };
                result.phase = OperationPhase::Completed;
                result.diagnostics.clear();
            } else if result.state == MutationState::SavedPendingProjection && snapshot.projected {
                result.state = MutationState::Completed;
            } else {
                result.diagnostics.push(AuthoringError::new(Code::PartiallyApplied, "operation", format!("Last acknowledged phase: {}. Inspect the returned form and preserved columns. Repair remaining work with a new targeted EditForm or SetFormAccess request against this revision; do not create another form. An in-flight operation may still finish.", result.phase)).into());
            }
        }
        result.saved = Some(self.saved(&actor.user_id, snapshot.clone()).await?);
        // Inspection must not overwrite the record of a concurrently executing
        // claimant. Reconciliation is returned, not persisted or replayed.
        Ok(result)
    }
    async fn baseline(
        &self,
        actor: &Viewer,
        form: FormId,
        revision: AuthoringRevisionId,
    ) -> Result<Snapshot, AuthoringError> {
        self.journal
            .baseline(&actor.user_id, form, revision)
            .await?
            .ok_or_else(|| {
                AuthoringError::new(
                    Code::ExpiredRevision,
                    "baseRevision",
                    "ReadForm again: this baseline expired or belongs to another form or actor.",
                )
            })
    }
    async fn saved(
        &self,
        user: &MacroUserIdStr<'_>,
        mut snapshot: Snapshot,
    ) -> Result<SavedForm, AuthoringError> {
        if snapshot.access == FormAccess::Owner {
            snapshot.grants = self.journal.grants(snapshot.form.id).await?;
        }
        let revision = self.journal.retain(user, &snapshot).await?;
        let id = snapshot.form.id;
        Ok(SavedForm {
            revision,
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
        })
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
