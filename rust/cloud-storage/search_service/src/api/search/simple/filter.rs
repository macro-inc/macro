//! This module is responsible for defining a trait to convert item_filters into a UnifiedSearchArgsVariant
//! This is used in simple_unified.rs

use opensearch_client::search::unified::{
    UnifiedChannelMessageSearchArgs, UnifiedChatSearchArgs, UnifiedDocumentSearchArgs,
    UnifiedEmailSearchArgs, UnifiedProjectSearchArgs,
};

use crate::api::{
    context::ApiContext,
    search::simple::{
        SearchError, simple_channel::filter_channels, simple_chat::filter_chats,
        simple_document::filter_documents, simple_project::filter_projects,
    },
};

#[derive(Debug)]
pub(super) enum UnifiedSearchArgsVariant {
    Document(UnifiedDocumentSearchArgs),
    Channel(UnifiedChannelMessageSearchArgs),
    Chat(UnifiedChatSearchArgs),
    Project(UnifiedProjectSearchArgs),
    Email(UnifiedEmailSearchArgs),
}

/// Trait to convert item_filters into a UnifiedSearchArgsVariant
pub(super) trait FilterVariantToSearchArgs {
    fn filter_to_search_args(
        &self,
        ctx: &ApiContext,
        user_id: &str,
        user_organization_id: Option<i32>,
        should_include: bool,
    ) -> impl Future<Output = Result<UnifiedSearchArgsVariant, SearchError>> + Send;
}

impl FilterVariantToSearchArgs for item_filters::DocumentFilters {
    async fn filter_to_search_args(
        &self,
        ctx: &ApiContext,
        user_id: &str,
        _user_organization_id: Option<i32>,
        should_include: bool,
    ) -> Result<UnifiedSearchArgsVariant, SearchError> {
        if !should_include {
            Ok(UnifiedSearchArgsVariant::Document(
                UnifiedDocumentSearchArgs::default(),
            ))
        } else {
            let filter_document_response = filter_documents(ctx, user_id, self).await?;

            Ok(UnifiedSearchArgsVariant::Document(
                UnifiedDocumentSearchArgs {
                    document_ids: filter_document_response.document_ids,
                    ids_only: filter_document_response.ids_only,
                },
            ))
        }
    }
}

impl FilterVariantToSearchArgs for item_filters::ChannelFilters {
    async fn filter_to_search_args(
        &self,
        ctx: &ApiContext,
        user_id: &str,
        user_organization_id: Option<i32>,
        should_include: bool,
    ) -> Result<UnifiedSearchArgsVariant, SearchError> {
        if !should_include {
            Ok(UnifiedSearchArgsVariant::Channel(
                UnifiedChannelMessageSearchArgs::default(),
            ))
        } else {
            let filter_channel_response =
                filter_channels(ctx, user_id, user_organization_id, self).await?;

            Ok(UnifiedSearchArgsVariant::Channel(
                UnifiedChannelMessageSearchArgs {
                    channel_ids: filter_channel_response
                        .channel_ids
                        .iter()
                        .map(|c| c.to_string())
                        .collect(),
                    thread_ids: self.thread_ids.clone(),
                    mentions: self.mentions.clone(),
                    sender_ids: self.sender_ids.clone(),
                },
            ))
        }
    }
}

impl FilterVariantToSearchArgs for item_filters::ChatFilters {
    async fn filter_to_search_args(
        &self,
        ctx: &ApiContext,
        user_id: &str,
        _user_organization_id: Option<i32>,
        should_include: bool,
    ) -> Result<UnifiedSearchArgsVariant, SearchError> {
        if !should_include {
            Ok(UnifiedSearchArgsVariant::Chat(
                UnifiedChatSearchArgs::default(),
            ))
        } else {
            let filter_chat_response = filter_chats(ctx, user_id, self).await?;

            Ok(UnifiedSearchArgsVariant::Chat(UnifiedChatSearchArgs {
                chat_ids: filter_chat_response.chat_ids,
                ids_only: filter_chat_response.ids_only,
                role: self.role.clone(),
            }))
        }
    }
}

impl FilterVariantToSearchArgs for item_filters::ProjectFilters {
    async fn filter_to_search_args(
        &self,
        ctx: &ApiContext,
        user_id: &str,
        _user_organization_id: Option<i32>,
        should_include: bool,
    ) -> Result<UnifiedSearchArgsVariant, SearchError> {
        if !should_include {
            Ok(UnifiedSearchArgsVariant::Project(
                UnifiedProjectSearchArgs::default(),
            ))
        } else {
            let filter_project_response = filter_projects(ctx, user_id, self).await?;

            Ok(UnifiedSearchArgsVariant::Project(
                UnifiedProjectSearchArgs {
                    project_ids: filter_project_response.project_ids,
                    ids_only: filter_project_response.ids_only,
                },
            ))
        }
    }
}

impl FilterVariantToSearchArgs for item_filters::EmailFilters {
    async fn filter_to_search_args(
        &self,
        _ctx: &ApiContext,
        _user_id: &str,
        _user_organization_id: Option<i32>,
        should_include: bool,
    ) -> Result<UnifiedSearchArgsVariant, SearchError> {
        if !should_include {
            Ok(UnifiedSearchArgsVariant::Email(
                UnifiedEmailSearchArgs::default(),
            ))
        } else {
            Ok(UnifiedSearchArgsVariant::Email(UnifiedEmailSearchArgs {
                thread_ids: vec![],
                link_ids: vec![],
                sender: self.senders.clone(),
                cc: self.cc.clone(),
                bcc: self.bcc.clone(),
                recipients: self.recipients.clone(),
            }))
        }
    }
}
