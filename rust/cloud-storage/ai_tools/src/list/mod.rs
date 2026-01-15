use crate::{AiToolSet, ToolScribe};
use ai_toolset::AsyncToolSet;
use email_service_client::EmailServiceClientExternal;
use std::sync::Arc;
mod channel;
mod email;
mod file;

pub fn list_toolset() -> AiToolSet {
    AsyncToolSet::new()
        .add_tool::<channel::ListChannels, Arc<ToolScribe>>()
        .expect("failed to add list channels")
        .add_tool::<email::ListEmails, Arc<EmailServiceClientExternal>>()
        .expect("failed to add list email")
        .add_tool::<file::ListDocuments, Arc<ToolScribe>>()
        .expect("failed to add list documents")
}
