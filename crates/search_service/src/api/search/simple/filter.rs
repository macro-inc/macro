//! This module is responsible for defining a trait to convert item_filters into a UnifiedSearchArgsVariant
//! This is used in simple_unified.rs

use comms_db_client::model::SimpleMention;
use item_filters::{EmailTextMatch, EmailTextPart};
use models_search::calendar_event::CalendarEventSearchScope;
use opensearch_client::search::emails::{EmailLabelCondition, EmailTextCondition, EmailTextFields};
use opensearch_client::search::unified::{
    UnifiedCalendarEventSearchArgs, UnifiedCallRecordSearchArgs, UnifiedChannelMessageSearchArgs,
    UnifiedChatSearchArgs, UnifiedDocumentSearchArgs, UnifiedEmailSearchArgs,
    UnifiedProjectSearchArgs,
};

use crate::domain::email_search::{EmailScope, MAX_EMAIL_PROJECTS, ThreadStates, ViewerInboxes};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use uuid::Uuid;

use crate::api::{
    context::SearchHandlerState,
    search::simple::{
        SearchError, simple_calendar_event::filter_calendar_events,
        simple_call_record::filter_calls, simple_channel::filter_channels,
        simple_chat::filter_chats, simple_document::filter_documents,
        simple_project::filter_projects,
    },
};

#[cfg(test)]
mod test;

/// Trait to convert item_filters into search args
pub(super) trait FilterVariantToSearchArgs {
    type Output;

    fn filter_to_search_args(
        &self,
        ctx: &SearchHandlerState,
        user_id: &str,
        user_organization_id: Option<i32>,
        should_include: bool,
    ) -> impl Future<Output = Result<Self::Output, SearchError>> + Send;
}

impl FilterVariantToSearchArgs for item_filters::DocumentFilters {
    type Output = UnifiedDocumentSearchArgs;

    async fn filter_to_search_args(
        &self,
        ctx: &SearchHandlerState,
        user_id: &str,
        _user_organization_id: Option<i32>,
        should_include: bool,
    ) -> Result<Self::Output, SearchError> {
        if !should_include {
            Ok(UnifiedDocumentSearchArgs::default())
        } else {
            let filter_document_response = filter_documents(ctx, user_id, self).await?;

            Ok(UnifiedDocumentSearchArgs {
                document_ids: filter_document_response.document_ids,
                ids_only: filter_document_response.ids_only,
                sub_types: self.sub_types.clone(),
                ..Default::default()
            })
        }
    }
}

impl FilterVariantToSearchArgs for item_filters::ChannelFilters {
    type Output = UnifiedChannelMessageSearchArgs;

    async fn filter_to_search_args(
        &self,
        ctx: &SearchHandlerState,
        user_id: &str,
        user_organization_id: Option<i32>,
        should_include: bool,
    ) -> Result<Self::Output, SearchError> {
        if !should_include {
            Ok(UnifiedChannelMessageSearchArgs::default())
        } else {
            let filter_channel_response =
                filter_channels(ctx, user_id, user_organization_id, self).await?;

            Ok(UnifiedChannelMessageSearchArgs {
                channel_ids: filter_channel_response
                    .channel_ids
                    .iter()
                    .map(|c| c.to_string())
                    .collect(),
                thread_ids: self.thread_ids.clone(),
                mentions: self
                    .mentions
                    .iter()
                    .map(|m| {
                        SimpleMention {
                            entity_type: "user".to_string(),
                            entity_id: m.clone(),
                        }
                        .to_string()
                    })
                    .collect(),
                sender_ids: self.sender_ids.clone(),
                ..Default::default()
            })
        }
    }
}

impl FilterVariantToSearchArgs for item_filters::ChatFilters {
    type Output = UnifiedChatSearchArgs;

    async fn filter_to_search_args(
        &self,
        ctx: &SearchHandlerState,
        user_id: &str,
        _user_organization_id: Option<i32>,
        should_include: bool,
    ) -> Result<Self::Output, SearchError> {
        if !should_include {
            Ok(UnifiedChatSearchArgs::default())
        } else {
            let filter_chat_response = filter_chats(ctx, user_id, self).await?;

            Ok(UnifiedChatSearchArgs {
                chat_ids: filter_chat_response.chat_ids,
                ids_only: filter_chat_response.ids_only,
                role: self.role.clone(),
                ..Default::default()
            })
        }
    }
}

impl FilterVariantToSearchArgs for item_filters::ProjectFilters {
    type Output = UnifiedProjectSearchArgs;

    async fn filter_to_search_args(
        &self,
        ctx: &SearchHandlerState,
        user_id: &str,
        _user_organization_id: Option<i32>,
        should_include: bool,
    ) -> Result<Self::Output, SearchError> {
        if !should_include {
            Ok(UnifiedProjectSearchArgs::default())
        } else {
            let filter_project_response = filter_projects(ctx, user_id, self).await?;

            Ok(UnifiedProjectSearchArgs {
                project_ids: filter_project_response.project_ids,
                ids_only: filter_project_response.ids_only,
                ..Default::default()
            })
        }
    }
}

/// What an email search sends to OpenSearch, and the thread states each
/// page's email hits are then checked against in Postgres.
pub(super) struct EmailSearch {
    pub args: UnifiedEmailSearchArgs,
    pub hit_states: ThreadStates,
    pub shared_capped: bool,
    pub project_capped: bool,
}

/// Email filters search cannot apply, rejected instead of ignored: the CRM
/// filters widen a list to the team's mailboxes under per-mailbox consent,
/// which only listing email implements.
pub(super) fn reject_unsupported_email_filters(
    filters: &item_filters::EmailFilters,
) -> Result<(), SearchError> {
    if !filters.crm_domains.is_empty() {
        return Err(SearchError::UnsupportedEmailFilter("crm_domains"));
    }
    if !filters.crm_addresses.is_empty() {
        return Err(SearchError::UnsupportedEmailFilter("crm_addresses"));
    }
    if filters.project_ids.len() > MAX_EMAIL_PROJECTS {
        return Err(SearchError::TooManyEmailProjects(MAX_EMAIL_PROJECTS));
    }
    Ok(())
}

fn text_condition(text_match: &EmailTextMatch) -> EmailTextCondition {
    EmailTextCondition {
        fields: match text_match.part {
            EmailTextPart::Any => EmailTextFields::Any,
            EmailTextPart::Subject => EmailTextFields::Subject,
            EmailTextPart::From => EmailTextFields::From,
            EmailTextPart::To => EmailTextFields::To,
            EmailTextPart::Cc => EmailTextFields::Cc,
            EmailTextPart::Bcc => EmailTextFields::Bcc,
        },
        text: text_match.text.clone(),
        exclude: text_match.exclude,
    }
}

/// Resolves the email threads `filters` reach for the caller, or `None` when
/// emails are left out or no thread can match.
pub(super) async fn email_search(
    ctx: &SearchHandlerState,
    user_id: &MacroUserId<Lowercase<'_>>,
    filters: &item_filters::EmailFilters,
    should_include: bool,
) -> Result<Option<EmailSearch>, SearchError> {
    reject_unsupported_email_filters(filters)?;
    if !should_include {
        return Ok(None);
    }
    // Every inbox the caller can reach (their own plus delegated). Connected
    // secondary inboxes share the owner's user_id; delegated inboxes index
    // under their own, so collect the distinct macro_ids the caller can search.
    let links =
        email_db_client::links::get::fetch_search_inboxes_for_macro_id(&ctx.db, user_id.as_ref())
            .await
            .map_err(SearchError::InternalError)?;
    let mut user_ids: Vec<String> = links.iter().map(|l| l.macro_id.clone()).collect();
    user_ids.sort();
    user_ids.dedup();
    // A mailbox being disconnected keeps its documents until its rows are
    // purged, which can take hours; its mail stops matching from the start.
    let disconnecting: Vec<String> = links
        .iter()
        .filter(|l| l.deleting)
        .map(|l| l.id.to_string())
        .collect();
    let inboxes = ViewerInboxes {
        link_ids: links.iter().map(|l| l.id).collect(),
        user_ids,
    };

    let scope = ctx
        .email_search()
        .scope(user_id, filters, &inboxes)
        .await
        .map_err(|error| SearchError::InternalError(anyhow::anyhow!("{error}")))?;
    let EmailScope::Threads(threads) = scope else {
        return Ok(None);
    };

    Ok(Some(EmailSearch {
        args: UnifiedEmailSearchArgs {
            user_ids: threads.user_ids,
            thread_ids: threads.thread_ids.iter().map(Uuid::to_string).collect(),
            ids_only: threads.ids_only,
            required_thread_ids: threads
                .required_thread_ids
                .iter()
                .map(Uuid::to_string)
                .collect(),
            sender: filters.senders.clone(),
            cc: filters.cc.clone(),
            bcc: filters.bcc.clone(),
            recipients: filters.recipients.clone(),
            link_ids: filters.link_ids.clone(),
            exclude_link_ids: disconnecting,
            include_labels: filters.include_labels.clone(),
            exclude_labels: filters.exclude_labels.clone(),
            importance: filters.importance,
            text_conditions: filters.text_matches.iter().map(text_condition).collect(),
            label_conditions: threads
                .label_conditions
                .into_iter()
                .map(|condition| EmailLabelCondition {
                    labels: condition.labels,
                    tag_option_ids: condition
                        .tag_option_ids
                        .iter()
                        .map(Uuid::to_string)
                        .collect(),
                    exclude: condition.exclude,
                })
                .collect(),
            exclude_thread_ids: threads
                .excluded_thread_ids
                .iter()
                .map(Uuid::to_string)
                .collect(),
            sent_after_millis: filters.sent_after.map(|after| after.timestamp_millis()),
            sent_before_millis: filters.sent_before.map(|before| before.timestamp_millis()),
            ..Default::default()
        },
        hit_states: threads.hit_states,
        shared_capped: threads.shared_capped,
        project_capped: threads.project_capped,
    }))
}

impl FilterVariantToSearchArgs for item_filters::CallFilters {
    type Output = UnifiedCallRecordSearchArgs;

    async fn filter_to_search_args(
        &self,
        ctx: &SearchHandlerState,
        user_id: &str,
        _user_organization_id: Option<i32>,
        should_include: bool,
    ) -> Result<Self::Output, SearchError> {
        if !should_include {
            return Ok(UnifiedCallRecordSearchArgs::default());
        }

        let response = filter_calls(ctx, user_id, self).await?;

        Ok(UnifiedCallRecordSearchArgs {
            call_ids: response.call_ids,
            channel_ids: response.channel_ids,
            speaker_ids: self.speaker_ids.clone(),
            ids_only: true,
            ..Default::default()
        })
    }
}

/// Calendar event filters with the set of events the request searches, which
/// lives on the request rather than in the soup-shaped filters.
pub(super) struct ScopedCalendarEventFilters {
    pub filters: item_filters::CalendarEventFilters,
    pub scope: CalendarEventSearchScope,
}

impl FilterVariantToSearchArgs for ScopedCalendarEventFilters {
    type Output = UnifiedCalendarEventSearchArgs;

    async fn filter_to_search_args(
        &self,
        ctx: &SearchHandlerState,
        user_id: &str,
        _user_organization_id: Option<i32>,
        should_include: bool,
    ) -> Result<Self::Output, SearchError> {
        if !should_include {
            return Ok(UnifiedCalendarEventSearchArgs::default());
        }

        let response = filter_calendar_events(ctx, user_id, &self.filters, self.scope).await?;

        Ok(UnifiedCalendarEventSearchArgs {
            calendar_event_ids: response.calendar_event_ids,
            link_ids: response.link_ids,
            ids_only: response.ids_only,
            statuses: self.filters.statuses.clone(),
            organizer_emails: self.filters.organizers.clone(),
            attendee_emails: self.filters.attendees.clone(),
            ..Default::default()
        })
    }
}
