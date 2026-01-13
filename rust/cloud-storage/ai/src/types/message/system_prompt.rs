use super::prompt_attachments::PromptAttachments;
use crate::tokens::{TokenCount, count_tokens};
use anyhow::Result;

#[derive(Debug, Clone)]
pub struct SystemPrompt {
    pub instructions: String,
    pub attachments: PromptAttachments,
}

impl TokenCount for SystemPrompt {
    fn token_count(&self) -> Result<i64> {
        count_tokens(&self.to_string())
    }
}

impl std::fmt::Display for SystemPrompt {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "{}", self.instructions)?;
        for attachment in self.attachments.iter() {
            writeln!(f, "{}", attachment)?;
        }
        Ok(())
    }
}
