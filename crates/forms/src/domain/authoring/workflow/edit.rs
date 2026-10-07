use super::*;
use models_forms::UpdateForm;

impl<
    C: AuthoringCore,
    D: DatabasesService,
    J: AuthoringJournal,
    B: AuthoringBooking,
    A: AuthoringAccess,
> AuthoringWorkflow<C, D, J, B, A>
{
    pub(super) async fn edit(
        &self,
        actor: Viewer,
        intent: Edit,
    ) -> Result<MutationResult, AuthoringError> {
        let receipt = self
            .receipt::<EditAccessLevel>(&actor, intent.form_id)
            .await?;
        // Retry lookup precedes baseline expiry and comparisons: a completed
        // request must return its recorded result even after its own writes.
        if let Some(operation) = self
            .journal
            .operation(
                &actor.user_id,
                AuthoringOperationId::from_uuid(intent.request_id.into_uuid()),
            )
            .await?
        {
            if operation.intent != Intent::Edit(intent) {
                return Err(AuthoringError::new(
                    Code::IdempotencyConflict,
                    "requestId",
                    "Use a new requestId for a changed intent.",
                ));
            }
            return Ok(operation.result);
        }
        let baseline = self
            .baseline(&actor, intent.form_id, intent.base_revision)
            .await?;
        let latest = self
            .core
            .authoring_snapshot(receipt.clone())
            .await
            .map_err(form_failure)?;
        let dependencies = schema_dependencies(&baseline.layout, &intent.changes);
        for id in &dependencies {
            if baseline.columns.iter().find(|c| c.id == *id)
                != latest.columns.iter().find(|c| c.id == *id)
            {
                return Err(stale("columns"));
            }
        }
        if intent.description.is_some() && baseline.form.description != latest.form.description {
            return Err(stale("description"));
        }
        if intent.confirmation_message.is_some()
            && baseline.form.confirmation_message != latest.form.confirmation_message
        {
            return Err(stale("confirmationMessage"));
        }
        if let Some(text) = &intent.description {
            validate::text(text, 10_000, "description")?;
        }
        if let Some(text) = &intent.confirmation_message {
            validate::text(text, 10_000, "confirmationMessage")?;
        }
        let layout = super::super::edit::apply(&baseline.layout, &latest.layout, &intent.changes)?;
        let added = validate::additions(&intent.new_columns, &latest.columns)?;
        let mut columns = latest.columns.clone();
        columns.extend(added.clone());
        validate::canonical_preserving(
            &layout,
            &columns,
            &managed(&latest),
            latest.form.audience,
            Some(&latest.layout),
        )?;
        for section in &layout.sections {
            if let models_forms::FormSection::Booking { target, .. } = section {
                let already_attached = latest.layout.sections.iter().any(|old| matches!(old,
                    models_forms::FormSection::Booking { target: existing, .. } if existing == target));
                if !already_attached {
                    self.booking.check_target(&actor, target).await?;
                }
            }
        }
        // Scheduling checks may await remote services. Recheck the facts this
        // edit depends on immediately before claiming and applying its writes.
        let checked = self
            .core
            .authoring_snapshot(receipt.clone())
            .await
            .map_err(form_failure)?;
        for id in &dependencies {
            if latest.columns.iter().find(|c| c.id == *id)
                != checked.columns.iter().find(|c| c.id == *id)
            {
                return Err(stale("columns"));
            }
        }
        if !revision_matches(&checked.revision, &latest.revision).map_err(failure)? {
            return Err(stale("baseRevision"));
        }
        let operation = Self::operation(
            Intent::Edit(intent.clone()),
            intent.form_id,
            Some(validate::Prepared {
                layout: layout.clone(),
                columns: added.clone(),
                keys: KeyMap::default(),
            }),
        );
        let mut operation = match self.journal.claim(&actor.user_id, operation).await? {
            Claim::Existing(operation) => return Ok(operation.result),
            Claim::New(operation) => operation,
        };
        let result = async {
            self.schema(actor.clone(), &latest, &added).await?;
            self.phase(&actor, &mut operation, OperationPhase::SchemaApplied)
                .await?;
            let snapshot = self
                .core
                .save_authoring_layout(receipt.clone(), latest.revision, layout)
                .await
                .map_err(form_failure)?;
            self.phase(&actor, &mut operation, OperationPhase::DraftSaved)
                .await?;
            if intent.description.is_some() || intent.confirmation_message.is_some() {
                // Recheck metadata after the collaborative write, so a human
                // metadata edit during that write is preserved.
                if intent.description.is_some()
                    && baseline.form.description != snapshot.form.description
                {
                    return Err(stale("description"));
                }
                if intent.confirmation_message.is_some()
                    && baseline.form.confirmation_message != snapshot.form.confirmation_message
                {
                    return Err(stale("confirmationMessage"));
                }
                self.journal
                    .settings(
                        &snapshot,
                        &UpdateForm {
                            description: intent.description,
                            confirmation_message: intent.confirmation_message,
                            ..Default::default()
                        },
                        &[],
                        false,
                        true,
                    )
                    .await?;
            }
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

fn schema_dependencies(
    layout: &FormLayout,
    changes: &[Change],
) -> std::collections::HashSet<models_databases::ColumnId> {
    use models_forms::FormSection;
    let mut ids = std::collections::HashSet::new();
    for change in changes {
        match change {
            Change::SetQuestion { question_id, .. } => {
                for section in &layout.sections {
                    if let FormSection::Questions { questions, .. } = section {
                        ids.extend(
                            questions
                                .iter()
                                .filter(|q| q.id == *question_id)
                                .map(|q| q.column),
                        );
                    }
                }
            }
            Change::SetGateRules { rules, .. } => {
                ids.extend(rules.conditions().iter().map(|c| c.column))
            }
            Change::AddQuestion { question, .. } => {
                ids.insert(question.column);
            }
            Change::AddSection { section, .. } => match section {
                FormSection::Questions { questions, .. } => {
                    ids.extend(questions.iter().map(|q| q.column))
                }
                FormSection::Gate { rules, .. } => {
                    ids.extend(rules.conditions().iter().map(|c| c.column))
                }
                FormSection::Booking { .. } => {}
            },
            _ => {}
        }
    }
    ids
}
