use crate::AiToolSet;
use ai::tool::AsyncToolSet;

mod search_service;
pub mod web;

pub fn search_toolset() -> AiToolSet {
    AsyncToolSet::new()
        .add_tool::<search_service::name::NameSearch>()
        .expect("failed to add name search tool")
        .add_tool::<search_service::content::ContentSearch>()
        .expect("failed to add content search tool")
}
