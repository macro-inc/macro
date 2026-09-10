use std::sync::Arc;

use agent_session::domain::model::AgentSessionId;
use macro_user_id::user_id::MacroUserIdStr;

use super::{LexicalPromptMentions, MentionSource, SessionViewers};
use crate::domain::error::{HarnessError, Result};
use crate::domain::ports::PromptMentions;

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).expect("a valid email")
}

struct FixedMentions(Result<Vec<String>>);

impl MentionSource for FixedMentions {
    async fn mentioned_user_ids(&self, _markdown: &str) -> Result<Vec<String>> {
        match &self.0 {
            Ok(ids) => Ok(ids.clone()),
            Err(_) => Err(HarnessError::Mentions(rootcause::report!("lexical down"))),
        }
    }
}

struct FixedViewers(Vec<MacroUserIdStr<'static>>);

impl SessionViewers for FixedViewers {
    async fn viewers(&self, _session_id: AgentSessionId) -> Result<Vec<MacroUserIdStr<'static>>> {
        Ok(self.0.clone())
    }
}

#[tokio::test]
async fn keeps_only_mentioned_users_who_can_open_the_session() {
    let mentions = LexicalPromptMentions::new(
        FixedMentions(Ok(vec![
            user("a@macro.com").to_string(),
            user("b@macro.com").to_string(),
            user("c@macro.com").to_string(),
            user("a@macro.com").to_string(),
        ])),
        Arc::new(FixedViewers(vec![
            user("owner@macro.com"),
            user("a@macro.com"),
            user("b@macro.com"),
        ])),
    );

    let users = mentions
        .mentioned_users(AgentSessionId::TEST_A, "@a @b @c @a")
        .await
        .expect("mentions resolve");

    assert_eq!(users, vec![user("a@macro.com"), user("b@macro.com")]);
}

#[tokio::test]
async fn a_prompt_naming_nobody_never_asks_who_can_see_the_session() {
    struct Unreachable;
    impl SessionViewers for Unreachable {
        async fn viewers(
            &self,
            _session_id: AgentSessionId,
        ) -> Result<Vec<MacroUserIdStr<'static>>> {
            panic!("viewers should not be resolved for a prompt with no mentions")
        }
    }
    let mentions = LexicalPromptMentions::new(FixedMentions(Ok(Vec::new())), Arc::new(Unreachable));

    let users = mentions
        .mentioned_users(AgentSessionId::TEST_A, "no mentions here")
        .await
        .expect("mentions resolve");

    assert!(users.is_empty());
}

#[tokio::test]
async fn ids_that_are_not_macro_users_are_skipped() {
    let mentions = LexicalPromptMentions::new(
        FixedMentions(Ok(vec![
            "not-a-user-id".to_owned(),
            user("a@macro.com").to_string(),
        ])),
        Arc::new(FixedViewers(vec![user("a@macro.com")])),
    );

    let users = mentions
        .mentioned_users(AgentSessionId::TEST_A, "@junk @a")
        .await
        .expect("mentions resolve");

    assert_eq!(users, vec![user("a@macro.com")]);
}

#[tokio::test]
async fn a_lexical_failure_is_an_error_not_an_empty_answer() {
    let mentions = LexicalPromptMentions::new(
        FixedMentions(Err(HarnessError::Mentions(rootcause::report!("down")))),
        Arc::new(FixedViewers(vec![user("a@macro.com")])),
    );

    let error = mentions
        .mentioned_users(AgentSessionId::TEST_A, "@a")
        .await
        .expect_err("the failure surfaces");

    assert!(matches!(error, HarnessError::Mentions(_)));
}
