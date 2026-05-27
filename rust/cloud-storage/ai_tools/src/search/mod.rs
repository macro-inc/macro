use crate::AiToolSet;
use ai_toolset::AsyncToolCollection;

mod search_service;

pub fn search_toolset() -> AiToolSet {
    AsyncToolCollection::new()
        .add_tool::<search_service::name::NameSearch, _>()
        .add_tool::<search_service::content::ContentSearch, _>()
}
