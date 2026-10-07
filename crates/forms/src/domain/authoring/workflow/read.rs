use super::*;

impl<
    C: AuthoringCore,
    D: DatabasesService,
    J: AuthoringJournal,
    B: AuthoringBooking,
    A: AuthoringAccess,
    E: AuthoringEditor,
> FormsAuthoringService for AuthoringWorkflow<C, D, J, B, A, E>
{
    async fn create_form(
        &self,
        actor: Viewer,
        intent: Create,
    ) -> Result<MutationResult, AuthoringError> {
        self.create(actor, intent).await
    }
    async fn edit_form(
        &self,
        actor: Viewer,
        intent: Edit,
    ) -> Result<MutationResult, AuthoringError> {
        self.edit(actor, intent).await
    }
    async fn set_form_access(
        &self,
        actor: Viewer,
        intent: SetAccess,
    ) -> Result<MutationResult, AuthoringError> {
        self.set_access(actor, intent).await
    }
    async fn read_form(&self, actor: Viewer, intent: Read) -> Result<ReadResult, AuthoringError> {
        match intent.view {
            ReadView::Authoring => {
                let earlier = if let Some(id) = intent.operation_id {
                    self.journal
                        .operation(&actor.user_id, id)
                        .await?
                        .filter(|o| o.result.form_id == intent.form_id)
                } else {
                    None
                };
                let receipt = match self
                    .receipt::<EditAccessLevel>(&actor, intent.form_id)
                    .await
                {
                    Ok(receipt) => receipt,
                    Err(error) => {
                        if let Some(operation) = earlier.filter(|o| o.result.saved.is_none()) {
                            return Ok(ReadResult::Operation {
                                operation: operation.result,
                            });
                        }
                        return Err(error);
                    }
                };
                let snapshot = self
                    .core
                    .authoring_snapshot(receipt.clone())
                    .await
                    .map_err(form_failure)?;
                let summary = if intent.include_summary {
                    Some(
                        self.core
                            .response_summary(receipt)
                            .await
                            .map_err(form_failure)?,
                    )
                } else {
                    None
                };
                let operation = if let Some(record) = earlier {
                    Some(self.inspect(&actor, record, &snapshot).await?)
                } else {
                    None
                };
                Ok(ReadResult::Authoring {
                    saved: Box::new(self.saved(&actor.user_id, snapshot).await?),
                    summary,
                    operation,
                })
            }
            ReadView::Respondent => {
                if intent.include_summary || intent.operation_id.is_some() {
                    return Err(AuthoringError::new(
                        Code::Forbidden,
                        "view",
                        "Response summaries and operations require an authoring read.",
                    ));
                }
                let receipt = self
                    .receipt::<ViewAccessLevel>(&actor, intent.form_id)
                    .await?;
                let mut detail = self.core.get_form(receipt).await.map_err(form_failure)?;
                // Choosing this view is an explicit least-privilege projection,
                // even when the actor also holds Owner or Edit.
                detail.access = FormAccess::View;
                for section in &mut detail.sections {
                    if let models_forms::FormSectionDetail::Booking { target, .. } = section {
                        *target = None;
                    }
                }
                let accepting_responses =
                    !detail.table_gone && detail.form.accepts_responses_at(chrono::Utc::now());
                Ok(ReadResult::Respondent {
                    detail,
                    respondent_url: self.respondent_url(intent.form_id),
                    accepting_responses,
                })
            }
        }
    }
    async fn list_forms(&self, actor: Viewer, intent: List) -> Result<ListResult, AuthoringError> {
        if let Some(query) = &intent.query {
            validate::text(query, 200, "query")?;
        }
        let query = intent.query.map(|q| q.trim().to_lowercase());
        let matches = self
            .core
            .accessible_forms(actor)
            .await
            .map_err(form_failure)?
            .into_iter()
            .filter(|item| {
                intent.status.is_none_or(|s| item.form.status == s)
                    && intent.access.is_none_or(|a| item.access >= a)
                    && intent
                        .database_id
                        .is_none_or(|d| item.form.database_id == d)
                    && query
                        .as_ref()
                        .is_none_or(|q| item.form.name.to_lowercase().contains(q))
            })
            .collect::<Vec<_>>();
        let total = matches.len();
        let forms = matches
            .into_iter()
            .take(50)
            .map(|item| ListItem {
                editor_url: self.editor_url(item.form.id),
                respondent_url: self.respondent_url(item.form.id),
                form: item.form,
                access: item.access,
            })
            .collect();
        Ok(ListResult {
            forms,
            total,
            truncated: total > 50,
        })
    }
}
