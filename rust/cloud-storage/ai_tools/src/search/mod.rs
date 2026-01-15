use crate::AiToolSet;
use ai_toolset::AsyncToolSet;
use search_service_client::SearchServiceClient;
use std::sync::Arc;

mod search_service;
pub mod web;

pub fn search_toolset() -> AiToolSet {
    AsyncToolSet::new()
        .add_tool::<search_service::name::NameSearch, Arc<SearchServiceClient>>()
        .expect("failed to add name search tool")
        .add_tool::<search_service::content::ContentSearch, Arc<SearchServiceClient>>()
        .expect("failed to add content search tool")
}
