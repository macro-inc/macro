use std::collections::BTreeMap;

use super::types::*;
impl RequestContentKind {
    pub fn text(text: String) -> Self {
        Self::Text {
            text,
            cache_control: None,
            citations: vec![],
        }
    }
}

impl SystemPrompt {
    pub fn push_text(&mut self, text: &str) {
        match self {
            Self::Blocks(parts) => {
                parts.push(SystemContent {
                    r#type: "text".into(),
                    text: text.to_owned(),
                    cache_control: None,
                    citations: None,
                });
            }
            Self::Text(prompt) => {
                prompt.push_str(text);
            }
        }
    }
}

impl RequestMessage {
    pub fn merge_message(self, other: Self) -> Self {
        match (self.content, other.content) {
            (RequestContent::Text(t), b) => Self {
                role: self.role,
                content: RequestContent::Blocks(vec![RequestContentKind::text(t)]),
            }
            .merge_message(Self {
                role: other.role,
                content: b,
            }),
            (RequestContent::Blocks(mut a), RequestContent::Blocks(mut b)) => {
                a.append(&mut b);
                Self {
                    role: self.role,
                    content: RequestContent::Blocks(a),
                }
            }
            (RequestContent::Blocks(mut a), RequestContent::Text(t)) => {
                a.push(RequestContentKind::text(t));
                Self {
                    role: self.role,
                    content: RequestContent::Blocks(a),
                }
            }
        }
    }
}

impl From<ServerTool> for Tool {
    fn from(value: ServerTool) -> Self {
        Self::Server(value)
    }
}

impl From<ClientTool> for Tool {
    fn from(value: ClientTool) -> Self {
        Self::Client(value)
    }
}

impl Tool {
    pub fn name(&self) -> &str {
        match self {
            Self::Client(ClientTool { name, .. }) => name.as_str(),
            Self::Server(ServerTool { name, .. }) => name.as_str(),
        }
    }
}

impl CreateMessageRequestBody {
    // openapi completions/v1 does not support ServerTools
    // this helper lets tools be directly added to the anthropic request
    // additional tools are deduplicated
    pub fn with_additional_tools<I, T>(mut self, tools: I) -> Self
    where
        I: IntoIterator<Item = T>,
        T: Into<Tool>,
    {
        match self.tools {
            Some(ref mut existing) => {
                existing.append(&mut tools.into_iter().map(Into::into).collect());
                let deduped = existing
                    .clone()
                    .into_iter()
                    .map(|t| (t.name().to_owned(), t))
                    .collect::<BTreeMap<_, _>>()
                    .into_values()
                    .collect::<Vec<_>>();
                self.tools = Some(deduped);
            }
            None => self.tools = Some(tools.into_iter().map(Into::into).collect()),
        }
        self
    }
}
