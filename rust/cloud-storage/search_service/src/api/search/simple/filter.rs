//! This module is responsible for defining a trait to convert item_filters into a UnifiedSearchArgsVariant
//! This is used in simple_unified.rs

use comms_db_client::model::SimpleMention;
use opensearch_client::search::unified::{
    UnifiedCallRecordSearchArgs, UnifiedChannelMessageSearchArgs, UnifiedChatSearchArgs,
    UnifiedDocumentSearchArgs, UnifiedEmailSearchArgs,
};

use crate::api::{
    context::SearchHandlerState,
    search::simple::{
        SearchError, simple_call_record::filter_calls, simple_channel::filter_channels,
        simple_chat::filter_chats, simple_document::filter_documents,
        simple_project::filter_projects,
    },
};

#[derive(Default, Debug, Clone)]
pub struct UnifiedProjectSearchArgs {
    pub project_ids: Vec<String>,
    pub ids_only: bool,
}

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
            })
        }
    }
}

impl FilterVariantToSearchArgs for item_filters::EmailFilters {
    type Output = UnifiedEmailSearchArgs;

    async fn filter_to_search_args(
        &self,
        _ctx: &SearchHandlerState,
        _user_id: &str,
        _user_organization_id: Option<i32>,
        should_include: bool,
    ) -> Result<Self::Output, SearchError> {
        if !should_include {
            Ok(UnifiedEmailSearchArgs::default())
        } else {
            Ok(UnifiedEmailSearchArgs {
                sender: self.senders.clone(),
                cc: self.cc.clone(),
                bcc: self.bcc.clone(),
                recipients: self.recipients.clone(),
                include_labels: self.include_labels.clone(),
                exclude_labels: self.exclude_labels.clone(),
                importance: self.importance,
                ..Default::default()
            })
        }
    }
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
