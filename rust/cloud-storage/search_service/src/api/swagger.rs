use document_sub_type::DocumentSubType;
use utoipa::OpenApi;

use crate::api::search;

use item_filters::{
    ChannelFilters, ChatFilters, DocumentFilters, EmailFilters, EntityFilters, NotificationFilters,
    ProjectFilters, PropertyFilter, SharedEmailFilter, TaskFilters,
};
use model::{document::FileType, response::EmptyResponse};
use models_search::channel::{
    ChannelSearchRequest, ChannelSearchResponse, ChannelSearchResponseItem, ChannelSearchResult,
    SimpleChannelSearchReponseItem, SimpleChannelSearchResponse,
};
use models_search::chat::{
    ChatMessageSearchResult, ChatSearchRequest, ChatSearchResponse, ChatSearchResponseItem,
    SimpleChatSearchResponse, SimpleChatSearchResponseItem,
};
use models_search::document::{
    DocumentSearchRequest, DocumentSearchResponse, DocumentSearchResponseItem,
    DocumentSearchResult, SimpleDocumentSearchResponse, SimpleDocumentSearchResponseItem,
};
use models_search::email::{
    EmailSearchRequest, EmailSearchResponse, EmailSearchResponseItem, EmailSearchResult,
    SimpleEmailSearchResponse, SimpleEmailSearchResponseItem,
};
use models_search::unified::{
    SimpleUnifiedSearchResponse, SimpleUnifiedSearchResponseItem, UnifiedSearchRequest,
    UnifiedSearchResponse, UnifiedSearchResponseItem,
};

use models_search::project::{
    ProjectSearchMetadata, ProjectSearchRequest, ProjectSearchResponse, ProjectSearchResponseItem,
    ProjectSearchResult, SimpleProjectSearchResponse, SimpleProjectSearchResponseItem,
};

use models_search::{MatchType, SearchHighlight};

#[derive(OpenApi)]
#[openapi(
        info(
                terms_of_service = "https://macro.com/terms",
        ),
        paths(
                /// /search
                search::unified::handler,

                /// /search/simple
                search::simple::simple_unified::handler,
        ),
        components(
            schemas(
                        EmptyResponse,
                        MatchType,
                        SearchHighlight,
                        DocumentSubType,

                        // Document
                        FileType, DocumentSearchRequest, DocumentSearchResult, DocumentSearchResponseItem, DocumentSearchResponse,

                        // Chat
                        ChatSearchRequest, ChatMessageSearchResult, ChatSearchResponseItem, ChatSearchResponse,

                        // Email
                        EmailSearchRequest, EmailSearchResult, EmailSearchResponseItem, EmailSearchResponse,

                        // Channel
                        ChannelSearchRequest, ChannelSearchResponse, ChannelSearchResponseItem, ChannelSearchResult,

                        // Unified
                        UnifiedSearchRequest, UnifiedSearchResponseItem, UnifiedSearchResponse,

                        // Entity filters (shared with soup)
                        EntityFilters, DocumentFilters, ChatFilters, EmailFilters, ChannelFilters, ProjectFilters,
                        PropertyFilter, NotificationFilters, TaskFilters, SharedEmailFilter,

                        // Project
                        ProjectSearchRequest, ProjectSearchResponse, ProjectSearchResponseItem, ProjectSearchResult, ProjectSearchMetadata,

                        // Simple
                        // SimpleDocument
                        SimpleDocumentSearchResponseItem, SimpleDocumentSearchResponse,
                        // SimpleChat
                        SimpleChatSearchResponseItem, SimpleChatSearchResponse,
                        // SimpleEmail
                        SimpleEmailSearchResponseItem, SimpleEmailSearchResponse,
                        // SimpleChannel
                        SimpleChannelSearchReponseItem, SimpleChannelSearchResponse,
                        // SimpleProject
                        SimpleProjectSearchResponseItem, SimpleProjectSearchResponse,
                        // SimpleUnified
                        SimpleUnifiedSearchResponseItem, SimpleUnifiedSearchResponse
                ),
        ),
        tags(
            (name = "search service", description = "Macro Search Service")
        )
    )]
pub struct ApiDoc;
