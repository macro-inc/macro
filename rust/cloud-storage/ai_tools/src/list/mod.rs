use crate::AiToolSet;
use ai::tool::AsyncToolSet;
mod email;
mod file;

pub fn list_toolset() -> AiToolSet {
    AsyncToolSet::new()
        .add_tool::<email::ListEmails>()
        .expect("failed to add list email")
        .add_tool::<file::ListDocuments>()
        .expect("failed to add list documents")
}
