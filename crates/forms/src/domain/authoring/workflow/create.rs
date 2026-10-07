use super::*;
use crate::domain::ports::{CreateFormCommand, CreateSource};
use models_forms::{FormSource, UpdateForm};

impl<
    C: AuthoringCore,
    D: DatabasesService,
    S: AuthoringSettings,
    B: AuthoringBooking,
    A: AuthoringAccess,
    E: AuthoringEditor,
> AuthoringWorkflow<C, D, S, B, A, E>
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
        let form_id = FormId::new();
        let outcome = Self::result(form_id, prepared.keys.clone());
        let result = async {
            self.core
                .create_private(
                    actor.clone(),
                    CreateFormCommand {
                        name: intent.name,
                        source,
                    },
                    form_id,
                )
                .await
                .map_err(form_failure)?;
            let receipt = self.receipt::<EditAccessLevel>(&actor, form_id).await?;
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
            let snapshot = self
                .core
                .save_authoring_layout(receipt.clone(), snapshot.revision, prepared.layout)
                .await
                .map_err(form_failure)?;
            self.settings
                .settings(
                    &snapshot,
                    &UpdateForm {
                        description: Some(intent.draft.description),
                        confirmation_message: Some(intent.draft.confirmation_message),
                        ..Default::default()
                    },
                    &[],
                    false,
                    true,
                )
                .await?;
            self.core.authoring_changed(receipt.clone(), false).await;
            self.core
                .authoring_snapshot(receipt)
                .await
                .map_err(form_failure)
        }
        .await;
        self.outcome(&actor, outcome, result).await
    }
}
