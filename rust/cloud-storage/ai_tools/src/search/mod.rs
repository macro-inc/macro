use crate::AiToolSet;
use ai_toolset::AsyncToolSet;

mod search_service;
pub mod web;

pub fn search_toolset() -> AiToolSet {
    AsyncToolSet::new()
        .add_tool::<search_service::name::NameSearch, _>()
        .add_tool::<search_service::content::ContentSearch, _>()
}
