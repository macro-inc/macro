use super::*;
use models_forms::UpdateForm;

impl<
    C: AuthoringCore,
    D: DatabasesService,
    S: AuthoringSettings,
    B: AuthoringBooking,
    A: AuthoringAccess,
    E: AuthoringEditor,
> AuthoringWorkflow<C, D, S, B, A, E>
{
    pub(super) async fn edit(
        &self,
        actor: Viewer,
        intent: Edit,
    ) -> Result<MutationResult, AuthoringError> {
        let receipt = self
            .receipt::<EditAccessLevel>(&actor, intent.form_id)
            .await?;
        let latest = self
            .core
            .authoring_snapshot(receipt.clone())
            .await
            .map_err(form_failure)?;
        if let Some(text) = &intent.description {
            validate::text(text, 10_000, "description")?;
        }
        if let Some(text) = &intent.confirmation_message {
            validate::text(text, 10_000, "confirmationMessage")?;
        }
        let layout = super::super::edit::apply(&latest.layout, &intent.changes)?;
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
        let update = self.editor.prepare_edit(&latest.document, &layout).await?;
        let prepared = crate::domain::collaboration::merged_layout(&latest.document, &update)
            .map_err(failure)?;
        if prepared.layout != layout {
            return Err(failure(
                "The AI editing worker returned a different layout.",
            ));
        }
        // Column schema is not CRDT state. Recheck touched dependencies after
        // remote booking checks; concurrent layout changes merge below.
        let checked = self
            .core
            .authoring_snapshot(receipt.clone())
            .await
            .map_err(form_failure)?;
        for id in schema_dependencies(&latest.layout, &intent.changes) {
            if latest.columns.iter().find(|column| column.id == id)
                != checked.columns.iter().find(|column| column.id == id)
            {
                return Err(stale("columns"));
            }
        }
        let outcome = Self::result(intent.form_id, KeyMap::default());
        let result = async {
            self.schema(actor.clone(), &latest, &added).await?;
            let snapshot = self
                .core
                .apply_authoring_update(receipt.clone(), update)
                .await?;
            if intent.description.is_some() || intent.confirmation_message.is_some() {
                // Recheck metadata after the collaborative write, so a human
                // metadata edit during that write is preserved.
                if intent.description.is_some()
                    && latest.form.description != snapshot.form.description
                {
                    return Err(stale("description"));
                }
                if intent.confirmation_message.is_some()
                    && latest.form.confirmation_message != snapshot.form.confirmation_message
                {
                    return Err(stale("confirmationMessage"));
                }
                self.settings
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
            self.core
                .authoring_snapshot(receipt)
                .await
                .map_err(form_failure)
        }
        .await;
        self.outcome(&actor, outcome, result).await
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
