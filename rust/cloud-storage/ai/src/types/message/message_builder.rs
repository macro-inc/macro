use crate::types::{ChatMessage, ChatMessageContent, Role};

pub struct MessageBuilder<R, C> {
    content: C,
    role: R,
    image_urls: Option<Vec<String>>,
}

impl MessageBuilder<Role, ChatMessageContent> {
    pub fn build(self) -> ChatMessage {
        ChatMessage {
            content: self.content,
            role: self.role,
            image_urls: self.image_urls,
        }
    }
}

impl From<MessageBuilder<Role, ChatMessageContent>> for ChatMessage {
    fn from(val: MessageBuilder<Role, ChatMessageContent>) -> Self {
        val.build()
    }
}

impl Default for MessageBuilder<(), ()> {
    fn default() -> Self {
        Self::new()
    }
}

impl MessageBuilder<(), ()> {
    pub fn new() -> Self {
        Self {
            content: (),
            role: (),
            image_urls: None,
        }
    }
}

pub type NoRole = ();
// convenience methods to set role
impl<C> MessageBuilder<NoRole, C> {
    pub fn user(self) -> MessageBuilder<Role, C> {
        MessageBuilder {
            content: self.content,
            image_urls: self.image_urls,
            role: Role::User,
        }
    }

    pub fn assistant(self) -> MessageBuilder<Role, C> {
        MessageBuilder {
            content: self.content,
            image_urls: self.image_urls,
            role: Role::Assistant,
        }
    }

    pub fn system(self) -> MessageBuilder<Role, C> {
        MessageBuilder {
            content: self.content,
            image_urls: self.image_urls,
            role: Role::System,
        }
    }

    pub fn role(self, role: Role) -> MessageBuilder<Role, C> {
        MessageBuilder {
            content: self.content,
            image_urls: self.image_urls,
            role,
        }
    }
}

pub type NoContent = ();
impl<R> MessageBuilder<R, NoContent> {
    /// set content where T implements Into<ChatMessageContent>
    /// note: String can be converted to ChatMessageContent::Text
    pub fn content<T>(self, content: T) -> MessageBuilder<R, ChatMessageContent>
    where
        T: Into<ChatMessageContent>,
    {
        MessageBuilder {
            content: content.into(),
            image_urls: self.image_urls,
            role: self.role,
        }
    }
}

impl<R, C> MessageBuilder<R, C> {
    pub fn image_urls(mut self, image_urls: Vec<String>) -> Self {
        if image_urls.is_empty() {
            self.image_urls = None;
            self
        } else {
            self.image_urls = Some(image_urls);
            self
        }
    }
}
