use crate::tokens::{TokenCount, count_tokens};
use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize, Clone, Eq, PartialEq)]
pub struct PromptAttachment {
    pub id: String,
    pub file_type: String,
    pub name: String,
    pub content: String,
}

impl std::fmt::Debug for PromptAttachment {
    fn fmt(&self, fmt: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        fmt.debug_struct("PromptAttachment")
            .field("id", &self.id)
            .field("name", &self.name)
            .field("character_count", &self.content.len())
            .finish()
    }
}

#[derive(Deserialize, Serialize, Debug, Clone, Eq, PartialEq)]
pub(crate) struct SystemPrompt {
    pub content: String,
    pub attachments: Vec<PromptAttachment>,
}

impl TokenCount for SystemPrompt {
    fn token_count(&self) -> Result<i64> {
        let content = self.format();
        count_tokens(&content)
    }
}

impl SystemPrompt {
    fn format_attachment(attachment: &PromptAttachment) -> String {
        format!(
            "\n<document id={} filetype={} name={}>\n{}\n</document>\n\n",
            attachment.id,
            attachment.file_type.as_str(),
            attachment.name,
            attachment.content
        )
    }

    /// Convers the system prompt into a string
    pub fn format(&self) -> String {
        let mut attachments_string = String::new();
        for attachment in self.attachments.iter() {
            let attachment_string = Self::format_attachment(attachment);
            attachments_string.push_str(attachment_string.as_str());
        }
        format!("{}{}", self.content, attachments_string)
    }

    pub fn format_for_caching(&mut self, n_parts: usize) -> Vec<String> {
        assert!(n_parts > 0);
        // order by decreasing length
        self.attachments
            .sort_by(|a, b| b.content.len().cmp(&a.content.len()));

        let mut attachments = self
            .attachments
            .iter()
            .map(Self::format_attachment)
            .collect::<Vec<_>>();
        let mut parts = vec![self.content.clone()];
        parts.append(&mut attachments);
        if parts.len() <= n_parts {
            parts
        } else {
            // expect 4, have 6
            // [_,_,_,3]
            // [_,_,_,_,4,5]

            // [4,5]
            let excess = parts.split_off(n_parts);
            if let Some(last) = parts.last_mut() {
                // [_,_,_,345]
                last.push_str(excess.join("").as_str())
            }
            parts
        }
    }
}
