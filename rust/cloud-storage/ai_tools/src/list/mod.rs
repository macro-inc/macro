use crate::AiToolSet;
use ai_toolset::AsyncToolSet;
mod channel;
mod email;
mod file;

pub fn list_toolset() -> AiToolSet {
    AsyncToolSet::new()
        .add_tool::<channel::ListChannels, _>()
        .expect("failed to add list channels")
        .add_tool::<email::ListEmails, _>()
        .expect("failed to add list email")
        .add_tool::<file::ListDocuments, _>()
        .expect("failed to add list documents")
}
