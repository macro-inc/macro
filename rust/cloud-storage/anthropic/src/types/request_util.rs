use super::request::*;

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
