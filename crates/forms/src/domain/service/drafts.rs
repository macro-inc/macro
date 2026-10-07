//! The shared layout is authoritative. Respondent reads refresh its validated
//! projection from the durable snapshot, including after the last editor left.

use databases::domain::models::TableDetail;
use databases::domain::ports::{DatabaseMetadataReads, DatabaseRowReads, DatabasesService};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt};
use macro_event_broker::MacroEventBroker;
use models_forms::{FormCollaboration, FormPublicationProblem};

use super::layout::{asks_for_a_file, form_detail, validate_layout};
use super::{FormsServiceImpl, receipt_access, receipt_form_id, repository_error};
use crate::domain::collaboration;
use crate::domain::drafts::{
    FormDraftError, FormDraftRepository, FormDraftStore, LayoutProjection,
};
use crate::domain::models::{
    Audience, Form, FormError, FormLayout, LayoutProblem, LayoutReplacement,
};
use crate::domain::ports::{Clock, FormAccessDirectory, FormEventPublisher, FormsRepo};

/// The layout respondents can use and any current draft validation failure.
pub(super) struct RefreshedLayout {
    pub(super) layout: FormLayout,
    pub(super) publication_error: Option<FormPublicationProblem>,
}

pub(super) fn draft_error(error: FormDraftError) -> FormError {
    match error {
        FormDraftError::Conflict => FormError::Conflict,
        FormDraftError::Unavailable(error) => FormError::Collaboration(error),
    }
}

fn codec_error(error: collaboration::LayoutDraftError) -> FormError {
    FormError::Collaboration(rootcause::Report::new(error).into_dynamic())
}

fn publication_problem(error: FormError) -> FormPublicationProblem {
    match error {
        FormError::InvalidLayout(problem) => FormPublicationProblem::Layout { problem },
        FormError::WidgetMismatch { question } => {
            FormPublicationProblem::WidgetMismatch { question }
        }
        FormError::FileUploadNeedsSignIn => FormPublicationProblem::FileUploadNeedsSignIn,
        unexpected => {
            tracing::error!(error = ?unexpected, "unexpected form publication refusal");
            FormPublicationProblem::Pending
        }
    }
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
    async fn ensure_draft(&self, form: &Form) -> Result<(), FormError> {
        let state = self
            .repository
            .draft_state(form.id)
            .await
            .map_err(repository_error)?
            .ok_or(FormError::NotFound)?;
        if state.enabled {
            return Ok(());
        }
        let layout = self
            .repository
            .layout(form.id)
            .await
            .map_err(repository_error)?;
        let snapshot = collaboration::seed_layout(&layout).map_err(codec_error)?;
        self.drafts
            .ensure(form.id, snapshot)
            .await
            .map_err(draft_error)?;
        if !self
            .repository
            .enable_draft(form.id)
            .await
            .map_err(repository_error)?
        {
            return Err(FormError::NotFound);
        }
        Ok(())
    }

    pub(super) async fn collaborate(
        &self,
        receipt: &EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<FormCollaboration, FormError> {
        let form = self.live_form(receipt_form_id(receipt)?).await?;
        let table = self.live_table_of(&form).await?;
        self.ensure_draft(&form).await?;
        let refreshed = self.refresh_layout(&form, Some(&table)).await?;
        Ok(FormCollaboration {
            detail: form_detail(
                form,
                receipt_access(receipt),
                refreshed.layout,
                Some(&table),
            ),
            publication_error: refreshed.publication_error,
        })
    }

    pub(super) async fn refresh_layout(
        &self,
        form: &Form,
        table: Option<&TableDetail>,
    ) -> Result<RefreshedLayout, FormError> {
        // These are bounded retries of a compare-and-set conflict, not a
        // timer/polling loop. Each attempt reads a fresh durable snapshot.
        for _attempt in 0..3 {
            let state = self
                .repository
                .draft_state(form.id)
                .await
                .map_err(repository_error)?
                .ok_or(FormError::NotFound)?;
            let Some(table) = table.filter(|_| state.enabled) else {
                return Ok(RefreshedLayout {
                    layout: self
                        .repository
                        .layout(form.id)
                        .await
                        .map_err(repository_error)?,
                    publication_error: None,
                });
            };
            let snapshot = self.drafts.snapshot(form.id).await.map_err(draft_error)?;
            let draft = match collaboration::read_layout(&snapshot) {
                Ok(draft) => draft,
                Err(_) => {
                    return Ok(RefreshedLayout {
                        layout: self
                            .repository
                            .layout(form.id)
                            .await
                            .map_err(repository_error)?,
                        publication_error: Some(FormPublicationProblem::InvalidDraft),
                    });
                }
            };
            if let Err(error) = validate_layout(&draft.layout, form, table) {
                return Ok(RefreshedLayout {
                    layout: self
                        .repository
                        .layout(form.id)
                        .await
                        .map_err(repository_error)?,
                    publication_error: Some(publication_problem(error)),
                });
            }
            if let Some(previous) = &state.revision
                && collaboration::revision_matches(previous, &draft.revision)
                    .map_err(codec_error)?
            {
                return Ok(RefreshedLayout {
                    layout: draft.layout,
                    publication_error: None,
                });
            }
            if let Some(previous) = &state.revision
                && !collaboration::revision_includes(&draft.revision, previous)
                    .map_err(codec_error)?
            {
                // A stale snapshot cannot replace a newer published revision.
                return Err(FormError::Conflict);
            }
            let required_audience = asks_for_a_file(&draft.layout).then_some(Audience::Members);
            let outcome = self
                .repository
                .project_layout(
                    form.id,
                    &draft.layout,
                    state.revision.as_deref(),
                    &draft.revision,
                    self.now(),
                    required_audience,
                )
                .await
                .map_err(repository_error)?;
            let error = match outcome {
                LayoutProjection::RevisionChanged => continue,
                LayoutProjection::Written(LayoutReplacement::DraftRequired) => {
                    return Err(FormError::Conflict);
                }
                LayoutProjection::Written(LayoutReplacement::Replaced) => {
                    self.announce(form.id).await;
                    return Ok(RefreshedLayout {
                        layout: draft.layout,
                        publication_error: None,
                    });
                }
                LayoutProjection::Written(LayoutReplacement::FormGone) => {
                    return Err(FormError::NotFound);
                }
                LayoutProjection::Written(LayoutReplacement::AudienceChanged) => {
                    FormError::FileUploadNeedsSignIn
                }
                LayoutProjection::Written(LayoutReplacement::IdTaken(id)) => {
                    LayoutProblem::RepeatedId { id }.into()
                }
            };
            return Ok(RefreshedLayout {
                layout: self
                    .repository
                    .layout(form.id)
                    .await
                    .map_err(repository_error)?,
                publication_error: Some(publication_problem(error)),
            });
        }
        Err(FormError::Conflict)
    }

    /// SDK replacements also write the one Loro document, so a later browser
    /// reconnect cannot restore a separate stale relational layout.
    pub(super) async fn replace_draft(
        &self,
        form: &Form,
        table: &TableDetail,
        layout: &FormLayout,
    ) -> Result<RefreshedLayout, FormError> {
        validate_layout(layout, form, table)?;
        if let Some(id) = self
            .repository
            .conflicting_layout_id(form.id, layout)
            .await
            .map_err(repository_error)?
        {
            return Err(LayoutProblem::RepeatedId { id }.into());
        }
        // Keep a known published version to return if publication cannot finish
        // after the durable write. A successful draft write is never reported as
        // an ordinary refusal implying that nothing changed.
        let published = self
            .repository
            .layout(form.id)
            .await
            .map_err(repository_error)?;
        self.ensure_draft(form).await?;
        let snapshot = self.drafts.snapshot(form.id).await.map_err(draft_error)?;
        let change = collaboration::replace_layout(&snapshot, layout).map_err(codec_error)?;
        self.drafts
            .update(form.id, change.expected_revision, change.update)
            .await
            .map_err(draft_error)?;
        match self.refresh_layout(form, Some(table)).await {
            Ok(refreshed) => Ok(refreshed),
            Err(error) => {
                tracing::error!(form_id = %form.id, error = ?error, "saved form draft could not be published");
                Ok(RefreshedLayout {
                    layout: published,
                    publication_error: Some(FormPublicationProblem::Pending),
                })
            }
        }
    }
}
