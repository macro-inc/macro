use crate::types::{ChatMessage, ChatMessageContent, Role};
use attachment::Attachments;

pub struct MessageBuilder<R, C> {
    content: C,
    role: R,
    attachments: Option<Attachments<'static>>,
}

impl MessageBuilder<Role, ChatMessageContent> {
    pub fn build(self) -> ChatMessage {
        ChatMessage {
            content: self.content,
            role: self.role,
            attachments: self.attachments,
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
            attachments: None,
        }
    }
}

pub type NoRole = ();
// convenience methods to set role
impl<C> MessageBuilder<NoRole, C> {
    pub fn user(self) -> MessageBuilder<Role, C> {
        MessageBuilder {
            content: self.content,
            attachments: self.attachments,
            role: Role::User,
        }
    }

    pub fn assistant(self) -> MessageBuilder<Role, C> {
        MessageBuilder {
            content: self.content,
            attachments: self.attachments,
            role: Role::Assistant,
        }
    }

    pub fn system(self) -> MessageBuilder<Role, C> {
        MessageBuilder {
            content: self.content,
            attachments: self.attachments,
            role: Role::System,
        }
    }

    pub fn role(self, role: Role) -> MessageBuilder<Role, C> {
        MessageBuilder {
            content: self.content,
            attachments: self.attachments,
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
            attachments: self.attachments,
            role: self.role,
        }
    }

    pub fn text<T: Into<String>>(self, content: T) -> MessageBuilder<R, ChatMessageContent> {
        MessageBuilder {
            content: ChatMessageContent::Text(content.into()),
            attachments: self.attachments,
            role: self.role,
        }
    }
}

impl<R, C> MessageBuilder<R, C> {
    pub fn attachments(mut self, attachments: Attachments<'static>) -> Self {
        self.attachments = Some(attachments);
        self
    }
}
