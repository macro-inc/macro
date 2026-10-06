use super::*;
use crate::domain::ports::{CreateFormCommand, CreateSource};
use models_forms::{FormSource, UpdateForm};

impl<
    C: AuthoringCore,
    D: DatabasesService,
    J: AuthoringJournal,
    B: AuthoringBooking,
    A: AuthoringAccess,
> AuthoringWorkflow<C, D, J, B, A>
{
    pub(super) async fn create(
        &self,
        actor: Viewer,
        intent: Create,
    ) -> Result<MutationResult, AuthoringError> {
        validate::text(&intent.name, 200, "name")?;
        if intent.name.trim().is_empty() {
            return Err(AuthoringError::new(
                Code::InvalidName,
                "name",
                "Supply a nonempty form name.",
            ));
        }
        let previous = self
            .journal
            .operation(
                &actor.user_id,
                AuthoringOperationId::from_uuid(intent.request_id.into_uuid()),
            )
            .await?;
        if let Some(operation) = previous {
            if operation.intent != Intent::Create(intent) {
                return Err(AuthoringError::new(
                    Code::IdempotencyConflict,
                    "requestId",
                    "Use a new requestId for a changed intent.",
                ));
            }
            if operation.result.saved.is_some() {
                self.receipt::<EditAccessLevel>(&actor, operation.result.form_id)
                    .await?;
            }
            return Ok(operation.result);
        }
        let source = match intent.source {
            FormSource::New => CreateSource::NewDatabase,
            FormSource::Table {
                database_id,
                table_id,
            } => CreateSource::Table {
                receipt: self
                    .access
                    .receipt::<OwnerAccessLevel>(&actor, entity(database_id, EntityType::Database))
                    .await?,
                table_id,
            },
        };
        let (existing, protected) = self
            .core
            .authoring_source(&source)
            .await
            .map_err(form_failure)?;
        let prepared = validate::prepare(&intent.draft, &existing)?;
        let mut all_columns = existing.clone();
        all_columns.extend(prepared.columns.clone());
        validate::canonical(
            &prepared.layout,
            &all_columns,
            &protected,
            models_forms::Audience::Members,
        )?;
        self.targets(&actor, &prepared.layout).await?;
        let operation = Self::operation(
            Intent::Create(intent.clone()),
            FormId::new(),
            Some(prepared),
        );
        let mut operation = match self.journal.claim(&actor.user_id, operation).await? {
            Claim::New(operation) => operation,
            Claim::Existing(operation) => {
                if operation.result.saved.is_some() {
                    self.receipt::<EditAccessLevel>(&actor, operation.result.form_id)
                        .await?;
                }
                return Ok(operation.result);
            }
        };
        let result = async {
            let prepared = operation
                .prepared
                .clone()
                .expect("creation claims a prepared draft");
            self.core
                .create_private(
                    actor.clone(),
                    CreateFormCommand {
                        name: intent.name,
                        source,
                    },
                    operation.result.form_id,
                )
                .await
                .map_err(form_failure)?;
            self.phase(&actor, &mut operation, OperationPhase::FormCreated)
                .await?;
            let receipt = self
                .receipt::<EditAccessLevel>(&actor, operation.result.form_id)
                .await?;
            let snapshot = self
                .core
                .authoring_snapshot(receipt.clone())
                .await
                .map_err(form_failure)?;
            let mut all_columns = snapshot.columns.clone();
            all_columns.extend(prepared.columns.clone());
            validate::canonical(
                &prepared.layout,
                &all_columns,
                &managed(&snapshot),
                snapshot.form.audience,
            )?;
            self.schema(actor.clone(), &snapshot, &prepared.columns)
                .await?;
            self.phase(&actor, &mut operation, OperationPhase::SchemaApplied)
                .await?;
            let snapshot = self
                .core
                .save_authoring_layout(receipt.clone(), snapshot.revision, prepared.layout)
                .await
                .map_err(form_failure)?;
            self.phase(&actor, &mut operation, OperationPhase::DraftSaved)
                .await?;
            self.journal
                .settings(
                    &snapshot,
                    &UpdateForm {
                        description: Some(intent.draft.description),
                        confirmation_message: Some(intent.draft.confirmation_message),
                        ..Default::default()
                    },
                    &[],
                    false,
                )
                .await?;
            self.core.authoring_changed(receipt.clone(), false).await;
            self.phase(&actor, &mut operation, OperationPhase::SettingsApplied)
                .await?;
            self.core
                .authoring_snapshot(receipt)
                .await
                .map_err(form_failure)
        }
        .await;
        self.outcome(&actor, operation, result).await
    }
}
