use super::prompt_attachments::PromptAttachments;

#[derive(Debug, Clone)]
pub struct SystemPrompt {
    pub instructions: String,
    pub attachments: PromptAttachments,
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
