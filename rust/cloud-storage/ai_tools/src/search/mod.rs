use crate::AiToolSet;
use ai_toolset::AsyncToolSet;

mod search_service;
pub mod web;

pub fn search_toolset() -> AiToolSet {
    AsyncToolSet::new()
        .add_tool::<search_service::name::NameSearch, _>()
        .expect("failed to add name search tool")
        .add_tool::<search_service::content::ContentSearch, _>()
        .expect("failed to add content search tool")
}
