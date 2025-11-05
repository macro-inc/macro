use super::request::*;

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
    fn make_multipart(&mut self) {
        match &self.content {
            RequestContent::Blocks(_) => {}
            RequestContent::Text(text) => {
                (*self) = Self {
                    content: RequestContent::Blocks(vec![RequestContentKind::Text {
                        text: text.to_owned(),
                        cache_control: None,
                        citations: vec![],
                    }]),
                    role: self.role,
                }
            }
        }
    }

    fn content_parts_mut(&mut self) -> &mut Vec<RequestContentKind> {
        self.make_multipart();
        if let RequestContent::Blocks(ref mut parts) = self.content {
            parts
        } else {
            panic!("how did we get here?")
        }
    }

    fn content_parts(&mut self) -> &[RequestContentKind] {
        self.make_multipart();
        if let RequestContent::Blocks(ref parts) = self.content {
            parts.as_slice()
        } else {
            panic!("how did we get here?")
        }
    }

    pub fn merge_message(&mut self, mut other: Self) {
        let parts = self.content_parts_mut();
        parts.extend_from_slice(other.content_parts());
    }
}
