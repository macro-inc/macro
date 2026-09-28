//! Scripted [`PromptMentions`] test double.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use agent_session::domain::model::AgentSessionId;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::error::{HarnessError, Result};
use crate::domain::ports::PromptMentions;

/// A [`PromptMentions`] that answers every prompt with the same users, or
/// fails every time. Finds nobody by default. Cloning shares one script.
#[derive(Clone, Default)]
pub struct PromptMentionsMock {
    mentioned: Arc<Mutex<Vec<MacroUserIdStr<'static>>>>,
    failure: Arc<Mutex<Option<String>>>,
    prompts: Arc<Mutex<Vec<String>>>,
}

impl PromptMentionsMock {
    /// A mock that mentions nobody and never fails.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Answer every prompt with `users` from now on.
    pub fn mentions(&self, users: Vec<MacroUserIdStr<'static>>) {
        *self
            .mentioned
            .lock()
            .expect("mentions mock lock should not be poisoned") = users;
    }

    /// Fail every resolution from now on.
    pub fn fails(&self, message: &str) {
        *self
            .failure
            .lock()
            .expect("mentions mock failure lock should not be poisoned") = Some(message.to_owned());
    }

    /// Every prompt this mock was asked about, in order.
    #[must_use]
    pub fn prompts(&self) -> Vec<String> {
        self.prompts
            .lock()
            .expect("mentions mock prompts lock should not be poisoned")
            .clone()
    }
}

impl PromptMentions for PromptMentionsMock {
    fn share_with_mentioned<'a>(
        &'a self,
        _session_id: AgentSessionId,
        _actor: Option<&'a MacroUserIdStr<'static>>,
        prompt_markdown: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<MacroUserIdStr<'static>>>> + Send + 'a>> {
        self.prompts
            .lock()
            .expect("mentions mock prompts lock should not be poisoned")
            .push(prompt_markdown.to_owned());
        let failure = self
            .failure
            .lock()
            .expect("mentions mock failure lock should not be poisoned")
            .clone();
        let mentioned = self
            .mentioned
            .lock()
            .expect("mentions mock lock should not be poisoned")
            .clone();
        Box::pin(async move {
            match failure {
                Some(message) => Err(HarnessError::Mentions(rootcause::report!("{message}"))),
                None => Ok(mentioned),
            }
        })
    }
}
