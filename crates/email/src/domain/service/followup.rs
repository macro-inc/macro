use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::{
    followup::{EmailFollowupMailbox, EmailFollowupRepo, FollowupThread, ReminderThreadFilter},
    models::{EmailErr, label::system_labels},
    ports::{EmailMessageEnqueuer, EmailRepo},
};
use frecency::domain::ports::FrecencyQueryService;
use macro_event_broker::MacroEventBroker;

use super::EmailServiceImpl;

impl<T, U, E, CS, Eam, B> EmailFollowupMailbox for EmailServiceImpl<T, U, E, CS, Eam, B>
where
    T: EmailRepo + EmailFollowupRepo,
    U: FrecencyQueryService,
    E: EmailMessageEnqueuer,
    CS: crm::domain::service::CrmService,
    Eam: Send + Sync + 'static,
    B: MacroEventBroker,
    anyhow::Error: From<T::Err> + From<E::Err>,
{
    async fn reminder_threads(
        &self,
        user: MacroUserIdStr<'static>,
        receipts: Vec<
            entity_access::domain::models::EntityAccessReceipt<
                entity_access::domain::models::ViewAccessLevel,
            >,
        >,
        filters: &ReminderThreadFilter,
    ) -> Result<Vec<Uuid>, EmailErr> {
        use crate::domain::models::{PreviewCursorQuery, PreviewView, PreviewViewStandardLabel};
        use filter_ast::Expr;
        use item_filters::ast::email::EmailLiteral;
        use models_pagination::{Query, SimpleSortMethod};
        use std::sync::Arc;

        let thread_ids: Vec<Uuid> = receipts
            .iter()
            .map(|receipt| receipt.entity().entity_id.parse::<Uuid>())
            .collect::<Result<_, _>>()
            .map_err(|error| EmailErr::RepoErr(error.into()))?;
        if thread_ids.is_empty() || filters.inbox_ids.as_ref().is_some_and(Vec::is_empty) {
            return Ok(Vec::new());
        }
        let links = self
            .email_repo
            .inboxes_for_macro_id(user.clone())
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?;
        let mut expression = thread_ids
            .iter()
            .map(|id| Expr::Literal(EmailLiteral::ThreadId(*id)))
            .reduce(Expr::or)
            .expect("nonempty candidate IDs");
        if let Some(ids) = &filters.inbox_ids {
            let selected = ids
                .iter()
                .map(|id| Expr::Literal(EmailLiteral::Owner(*id)))
                .reduce(Expr::or)
                .expect("nonempty inbox selection");
            expression = Expr::and(expression, selected);
        }
        for literal in [
            filters.done.map(|done| EmailLiteral::InboxVisible(!done)),
            filters.read.map(EmailLiteral::Read),
            filters.calendar.then_some(EmailLiteral::CalendarOnly(true)),
        ]
        .into_iter()
        .flatten()
        {
            expression = Expr::and(expression, Expr::Literal(literal));
        }
        if let Some(tags) = filters
            .tags
            .iter()
            .map(|(property, option)| {
                use item_filters::ast::properties::{
                    PropertiesLiteral, PropertyEntityType, PropertyMatchValue,
                };
                Expr::Literal(EmailLiteral::Property(PropertiesLiteral {
                    property_definition_id: *property,
                    entity_type: Some(PropertyEntityType::Thread),
                    value: PropertyMatchValue::SelectOption(*option),
                }))
            })
            .reduce(Expr::or)
        {
            expression = Expr::and(expression, tags);
        }
        let previews = self
            .email_repo
            .previews_for_view_cursor(
                PreviewCursorQuery {
                    view: PreviewView::StandardLabel(PreviewViewStandardLabel::All),
                    link_ids: links.into_iter().map(|link| link.id).collect(),
                    limit: thread_ids.len() as u32,
                    query: Query::new(
                        None,
                        SimpleSortMethod::UpdatedAt,
                        Some(Arc::new(expression)),
                    ),
                    team_id: None,
                },
                user,
            )
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?;
        let ids: Vec<_> = previews.into_iter().map(|thread| thread.id).collect();
        if filters.attachments.is_empty() {
            return Ok(ids);
        }
        let attachments = self
            .email_repo
            .attachments_by_thread_ids(&ids)
            .await
            .map_err(|error| EmailErr::RepoErr(anyhow::Error::from(error)))?;
        let matching: std::collections::HashSet<_> = attachments
            .into_iter()
            .filter(|attachment| {
                attachment
                    .mime_type
                    .as_deref()
                    .is_some_and(|mime| filters.attachments.iter().any(|kind| kind.matches(mime)))
            })
            .map(|attachment| attachment.thread_id)
            .collect();
        Ok(ids.into_iter().filter(|id| matching.contains(id)).collect())
    }

    async fn followup_thread(
        &self,
        user: MacroUserIdStr<'static>,
        thread_id: Uuid,
    ) -> Result<Option<FollowupThread>, EmailErr> {
        let Some(link) = self
            .email_repo
            .owned_link_for_thread(thread_id, user.clone())
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?
        else {
            return Ok(None);
        };
        let Some(thread) = self
            .email_repo
            .thread_by_id(thread_id)
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?
        else {
            return Ok(None);
        };
        let messages = self
            .email_repo
            .followup_messages(user, thread_id, link.id)
            .await?;
        if messages.is_empty() {
            return Ok(None);
        }
        let labels = self
            .email_repo
            .labels_by_thread_ids(&[thread_id])
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?;
        let latest = self
            .email_repo
            .latest_content_message_rows(&[thread_id])
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?;
        Ok(Some(FollowupThread {
            link_id: link.id,
            subject: latest
                .into_iter()
                .next()
                .and_then(|message| message.subject)
                .filter(|subject| !subject.trim().is_empty())
                .unwrap_or_else(|| "Email follow-up".into()),
            inbox_visible: thread.inbox_visible,
            returned_at: self
                .email_repo
                .followup_returned_at(thread_id, link.id)
                .await?,
            unavailable: labels.iter().any(|label| {
                matches!(
                    label.provider_label_id.as_str(),
                    system_labels::TRASH | system_labels::SPAM
                )
            }),
            messages,
        }))
    }

    async fn set_followup_inbox(
        &self,
        user: MacroUserIdStr<'static>,
        thread_id: Uuid,
        link_id: Uuid,
        visible: bool,
        returned_at: Option<DateTime<Utc>>,
    ) -> Result<(), EmailErr> {
        let facts = self
            .followup_thread(user.clone(), thread_id)
            .await?
            .filter(|facts| facts.link_id == link_id && !facts.unavailable)
            .ok_or(EmailErr::ThreadNotFound)?;
        let link = self
            .email_repo
            .owned_link_for_thread(thread_id, user.clone())
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?
            .filter(|link| link.id == facts.link_id)
            .ok_or(EmailErr::ThreadNotFound)?;
        let label = self
            .email_repo
            .list_labels_by_link_id(link.id)
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?
            .into_iter()
            .find(|label| label.provider_label_id == system_labels::INBOX)
            .ok_or(EmailErr::LabelNotFound)?;
        // Persist the explicit return before provider work/events can observe
        // INBOX, so sent-only metadata reconciliation sees the same intent.
        // A failed label write leaves a timestamp on an archived thread, which
        // remains excluded by inbox visibility and is retried by the workflow.
        if visible {
            self.email_repo
                .set_followup_returned_at(thread_id, link_id, returned_at)
                .await?;
        }
        self.update_thread_labels_with_actor(&link, thread_id, label.id, visible, Some(user))
            .await?;
        if !visible {
            self.email_repo
                .set_followup_returned_at(thread_id, link_id, None)
                .await?;
        }
        Ok(())
    }
}
