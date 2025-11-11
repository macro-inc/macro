use crate::types::{
    ChatCompletionRequest, ChatMessage, Model, PromptAttachment, Role, SystemPrompt,
};

#[derive(Default)]
pub struct Attachments(pub Vec<Attachment>);

impl From<Vec<PromptAttachment>> for Attachments {
    fn from(value: Vec<PromptAttachment>) -> Self {
        Attachments(value.into_iter().map(Attachment::Text).collect())
    }
}

impl From<Vec<Attachment>> for Attachments {
    fn from(value: Vec<Attachment>) -> Self {
        Attachments(value)
    }
}

pub enum Attachment {
    /// A document, channel, project, or other thing that can be represented by text
    /// These are inserted into the system prompt
    Text(PromptAttachment),
    /// a base64 or static url to a supported image type
    ImageUrl(String),
}

pub type NotSet = ();

pub struct RequestBuilder<ChatModel, Messages, Prompt> {
    /// Some function that expects a specific type.
    ///
    /// correct usage
    /// ```rust
    /// # use ai::types::{Model, MessageBuilder, Role, RequestBuilder};
    /// let request = RequestBuilder::new()
    ///     .system_prompt("do_stuff")
    ///     .messages(vec![
    ///         MessageBuilder::new()
    ///             .content("user message")
    ///             .role(Role::User)
    ///             .build() ,
    ///        MessageBuilder::new()
    ///             .content("assistant message")
    ///             .role(Role::Assistant)
    ///             .build()
    ///     ])
    ///     .model(Model::Claude35Sonnet)
    ///     .build();
    /// ```
    /// # Example
    /// incorrect usage
    /// ```rust,compile_fail
    /// // forgot model so compile fail :(
    /// let request = RequestBuilder::new()
    ///     .system_prompt("do a thing chat".into())
    ///     .messages(vec![
    ///         MessageBuilder::new()
    ///             .content("hi")
    ///             .role(Role::User)]
    ///     )
    ///     .build(); // doesn't exist :( bc model is not specified
    ///
    /// ```
    ///

    /// required model enum
    model: ChatModel,
    /// required chain of messages
    messages: Messages,
    /// required system prompt
    system_prompt: Prompt,
    /// optional max tokens (input + output)
    max_tokens: Option<u32>,
    /// optional list of attachments (prefetched)
    attachments: Option<Attachments>,
}

/// the build method only works if we have model, messages, and system prompt
impl RequestBuilder<Model, Vec<ChatMessage>, String> {
    pub fn build(mut self) -> ChatCompletionRequest {
        let (image_attachments, prompt_attachments) = std::mem::take(&mut self.attachments)
            .unwrap_or_default()
            .0
            .into_iter()
            .map(|attachment| match attachment {
                Attachment::ImageUrl(url) => (Some(url), None),
                Attachment::Text(text_attachment) => (None, Some(text_attachment)),
            })
            .collect::<(Vec<_>, Vec<_>)>();

        let image_attachments = image_attachments.into_iter().flatten().collect::<Vec<_>>();
        let prompt_attachments = prompt_attachments.into_iter().flatten().collect::<Vec<_>>();
        let system_prompt = SystemPrompt {
            attachments: prompt_attachments,
            content: std::mem::take(&mut self.system_prompt),
        };
        // insert images on the last user message  :)
        if !image_attachments.is_empty()
            && let Some(message) = self
                .messages
                .iter_mut()
                .rev()
                .find(|message| message.role == Role::User)
        {
            message.image_urls = Some(image_attachments);
        }

        ChatCompletionRequest {
            system_prompt,
            messages: self.messages,
            model: self.model,
        }
    }
}

impl From<RequestBuilder<Model, Vec<ChatMessage>, String>> for ChatCompletionRequest {
    fn from(val: RequestBuilder<Model, Vec<ChatMessage>, String>) -> Self {
        val.build()
    }
}

impl Default for RequestBuilder<(), (), ()> {
    fn default() -> Self {
        Self::new()
    }
}

impl RequestBuilder<(), (), ()> {
    pub fn new() -> Self {
        Self {
            attachments: None,
            max_tokens: None,
            messages: (),
            model: (),
            system_prompt: (),
        }
    }
}

// these methods set things and can be called in any order
impl<ChatModel, Messages, Prompt> RequestBuilder<ChatModel, Messages, Prompt> {
    /// set system prompt: Self<any, any, any> -> Self<any, any, String>
    pub fn system_prompt(
        self,
        system_prompt: impl Into<String>,
    ) -> RequestBuilder<ChatModel, Messages, String> {
        RequestBuilder {
            attachments: self.attachments,
            max_tokens: self.max_tokens,
            messages: self.messages,
            model: self.model,
            system_prompt: system_prompt.into(),
        }
    }

    // set text attachments
    pub fn attachments(mut self, attachments: impl Into<Attachments>) -> Self {
        let attachments = attachments.into();
        if attachments.0.is_empty() {
            self.attachments = None;
            self
        } else {
            self.attachments = Some(attachments);
            self
        }
    }

    pub fn add_text_attachment(mut self, attachment: impl Into<PromptAttachment>) -> Self {
        let wrapped = Attachment::Text(attachment.into());
        if let Some(ref mut attachments) = self.attachments {
            attachments.0.push(wrapped)
        } else {
            self.attachments = Some(vec![wrapped].into());
        }
        self
    }

    pub fn add_image_attachment(mut self, image_url: String) -> Self {
        let wrapped = Attachment::ImageUrl(image_url);
        if let Some(ref mut attachments) = self.attachments {
            attachments.0.push(wrapped)
        } else {
            self.attachments = Some(vec![wrapped].into());
        }
        self
    }

    // set messages
    pub fn messages(
        self,
        messages: Vec<ChatMessage>,
    ) -> RequestBuilder<ChatModel, Vec<ChatMessage>, Prompt> {
        RequestBuilder {
            attachments: self.attachments,
            max_tokens: self.max_tokens,
            messages,
            model: self.model,
            system_prompt: self.system_prompt,
        }
    }

    // set max tokens
    pub fn max_tokens(mut self, max_tokens: u32) -> Self {
        self.max_tokens = Some(max_tokens);
        self
    }

    // set model
    pub fn model(self, model: Model) -> RequestBuilder<Model, Messages, Prompt> {
        RequestBuilder {
            attachments: self.attachments,
            max_tokens: self.max_tokens,
            messages: self.messages,
            model,
            system_prompt: self.system_prompt,
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::types::{MessageBuilder, Model, PromptAttachment, Role};
    #[test]
    fn test_good_build() {
        let messages = vec![
            MessageBuilder::new()
                .content("user message 1")
                .role(Role::User)
                .build(),
            MessageBuilder::new()
                .content("assistant response")
                .role(Role::Assistant)
                .build(),
            MessageBuilder::new()
                .content("user message 2")
                .role(Role::User)
                .build(),
        ];

        let text_attachment = PromptAttachment {
            id: "doc1".to_string(),
            content: "Document content".to_string(),
            name: "Test Doc".to_string(),
            file_type: "md".into(),
        };

        let request = RequestBuilder::new()
            .system_prompt("Test system prompt".to_string())
            .messages(messages.clone())
            .model(Model::Claude35Sonnet)
            .max_tokens(1000)
            .add_text_attachment(text_attachment.clone())
            .add_image_attachment("https://example.com/image.jpg".to_string())
            .build();

        // Verify system prompt has text attachment
        assert_eq!(request.system_prompt.content, "Test system prompt");
        assert_eq!(request.system_prompt.attachments.len(), 1);
        assert_eq!(request.system_prompt.attachments[0].id, "doc1");

        // Verify model and max_tokens
        assert_eq!(request.model, Model::Claude35Sonnet);

        // Verify messages count
        assert_eq!(request.messages.len(), 3);

        // Verify last user message has image attachment
        let last_user_message = request
            .messages
            .iter()
            .rev()
            .find(|msg| msg.role == Role::User)
            .unwrap();
        assert!(last_user_message.image_urls.is_some());
        assert_eq!(last_user_message.image_urls.as_ref().unwrap().len(), 1);
        assert_eq!(
            last_user_message.image_urls.as_ref().unwrap()[0],
            "https://example.com/image.jpg"
        );
    }

    #[test]
    fn test_good_builder_no_options() {
        let messages = vec![
            MessageBuilder::new()
                .content("user message")
                .role(Role::User)
                .build(),
            MessageBuilder::new()
                .content("assistant response")
                .role(Role::Assistant)
                .build(),
        ];

        let request = RequestBuilder::new()
            .system_prompt("Basic system prompt".to_string())
            .messages(messages.clone())
            .model(Model::Claude35Sonnet)
            .build();

        // Verify system prompt (no attachments)
        assert_eq!(request.system_prompt.content, "Basic system prompt");
        assert!(request.system_prompt.attachments.is_empty());

        // Verify model and default max_tokens
        assert_eq!(request.model, Model::Claude35Sonnet);

        // Verify messages count
        assert_eq!(request.messages.len(), 2);

        // Verify no image attachments on any message
        for message in &request.messages {
            assert!(
                message.image_urls.is_none() || message.image_urls.as_ref().unwrap().is_empty()
            );
        }
    }
}
