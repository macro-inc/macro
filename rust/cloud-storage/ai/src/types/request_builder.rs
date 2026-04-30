use crate::types::{
    ChatCompletionRequest, ChatMessage, ChatMessageContent, Model, Role, SystemPrompt,
};
use attachment::Attachments;

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
    attachments: Option<Attachments<'static>>,
}

/// the build method only works if we have model, messages, and system prompt
impl RequestBuilder<Model, Vec<ChatMessage>, String> {
    pub fn build(mut self) -> ChatCompletionRequest {
        if let Some(attachments) = self.attachments.take()
            && let Some(message) = self
                .messages
                .iter_mut()
                .rev()
                .find(|message| message.role == Role::User)
        {
            message.attachments = Some(attachments);
        }

        ChatCompletionRequest {
            system_prompt: SystemPrompt {
                attachments: Default::default(),
                instructions: self.system_prompt,
            },
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

    pub fn attachments(mut self, attachments: Attachments<'static>) -> Self {
        self.attachments = Some(attachments);
        self
    }

    pub fn user_message(
        self,
        message: impl Into<String>,
    ) -> RequestBuilder<ChatModel, Vec<ChatMessage>, Prompt> {
        self.messages(vec![ChatMessage {
            content: ChatMessageContent::Text(message.into()),
            role: Role::User,
            attachments: None,
        }])
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
    use crate::types::{MessageBuilder, Model, Role};

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
            .messages(messages)
            .model(Model::Claude35Sonnet)
            .build();

        // Verify system prompt (no attachments)
        assert_eq!(request.system_prompt.instructions, "Basic system prompt");
        assert!(request.system_prompt.attachments.is_none());

        // Verify model and default max_tokens
        assert_eq!(request.model, Model::Claude35Sonnet);

        // Verify messages count
        assert_eq!(request.messages.len(), 2);

        for message in &request.messages {
            assert!(message.attachments.is_none());
        }
    }
}
