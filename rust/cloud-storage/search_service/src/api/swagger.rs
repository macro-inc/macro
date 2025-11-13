use utoipa::OpenApi;

use crate::api::{health, search};

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
    SimpleUnifiedSearchResponse, SimpleUnifiedSearchResponseItem, UnifiedSearchFilters,
    UnifiedSearchIndex, UnifiedSearchRequest, UnifiedSearchResponse, UnifiedSearchResponseItem,
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
                /// /health
                health::health_handler,

                /// /search
                search::document::handler,
                search::chat::handler,
                search::email::handler,
                search::channel::handler,
                search::unified::handler,
                search::project::handler,

                /// /search/simple
                search::simple::simple_document::handler,
                search::simple::simple_chat::handler,
                search::simple::simple_email::handler,
                search::simple::simple_channel::handler,
                search::simple::simple_project::handler,
                search::simple::simple_unified::handler,
        ),
        components(
            schemas(
                        EmptyResponse,
                        MatchType,
                        SearchHighlight,

                        // Document
                        FileType, DocumentSearchRequest, DocumentSearchResult, DocumentSearchResponseItem, DocumentSearchResponse,

                        // Chat
                        ChatSearchRequest, ChatMessageSearchResult, ChatSearchResponseItem, ChatSearchResponse,

                        // Email
                        EmailSearchRequest, EmailSearchResult, EmailSearchResponseItem, EmailSearchResponse,

                        // Channel
                        ChannelSearchRequest, ChannelSearchResponse, ChannelSearchResponseItem, ChannelSearchResult,

                        // Unified
                        UnifiedSearchIndex, UnifiedSearchRequest, UnifiedSearchResponseItem, UnifiedSearchResponse, UnifiedSearchFilters,

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
