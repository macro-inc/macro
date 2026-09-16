use std::collections::HashMap;
use std::sync::Mutex;

use agent_session::domain::model::AgentSessionId;
use entity_access::domain::models::AccessLevel;
use macro_user_id::user_id::MacroUserIdStr;

use super::{LexicalPromptMentions, MentionSource, SessionAccess};
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

/// Grants as a map, recording every edit grant asked for.
#[derive(Default)]
struct FixedAccess {
    levels: HashMap<MacroUserIdStr<'static>, AccessLevel>,
    granted: Mutex<Vec<Vec<MacroUserIdStr<'static>>>>,
}

impl FixedAccess {
    fn with(levels: impl IntoIterator<Item = (MacroUserIdStr<'static>, AccessLevel)>) -> Self {
        Self {
            levels: levels.into_iter().collect(),
            granted: Mutex::default(),
        }
    }

    fn granted(&self) -> Vec<Vec<MacroUserIdStr<'static>>> {
        self.granted.lock().expect("grants lock").clone()
    }
}

impl SessionAccess for &'static FixedAccess {
    async fn viewers(&self, _session_id: AgentSessionId) -> Result<Vec<MacroUserIdStr<'static>>> {
        Ok(self.levels.keys().cloned().collect())
    }

    async fn access_of(
        &self,
        _session_id: AgentSessionId,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Option<AccessLevel>> {
        Ok(self.levels.get(user).copied())
    }

    async fn grant_edit(
        &self,
        _session_id: AgentSessionId,
        users: &[MacroUserIdStr<'static>],
    ) -> Result<()> {
        self.granted
            .lock()
            .expect("grants lock")
            .push(users.to_vec());
        Ok(())
    }
}

fn access(levels: Vec<(MacroUserIdStr<'static>, AccessLevel)>) -> &'static FixedAccess {
    Box::leak(Box::new(FixedAccess::with(levels)))
}

fn owner() -> MacroUserIdStr<'static> {
    user("owner@macro.com")
}

#[tokio::test]
async fn an_editor_shares_the_session_with_everyone_they_mention() {
    let access = access(vec![
        (owner(), AccessLevel::Owner),
        (user("a@macro.com"), AccessLevel::Edit),
    ]);
    let mentions = LexicalPromptMentions::new(
        FixedMentions(Ok(vec![
            user("b@macro.com").to_string(),
            user("c@macro.com").to_string(),
            user("a@macro.com").to_string(),
            user("b@macro.com").to_string(),
        ])),
        access,
    );

    let users = mentions
        .share_with_mentioned(
            AgentSessionId::TEST_A,
            Some(&user("a@macro.com")),
            "@b @c @a @b",
        )
        .await
        .expect("mentions resolve");

    // b and c were strangers to the session; a is the author and is skipped.
    assert_eq!(users, vec![user("b@macro.com"), user("c@macro.com")]);
    assert_eq!(
        access.granted(),
        vec![vec![user("b@macro.com"), user("c@macro.com")]]
    );
}

#[tokio::test]
async fn a_viewer_amplifies_nobody_and_only_existing_viewers_are_named() {
    let access = access(vec![
        (owner(), AccessLevel::Owner),
        (user("a@macro.com"), AccessLevel::View),
        (user("b@macro.com"), AccessLevel::View),
    ]);
    let mentions = LexicalPromptMentions::new(
        FixedMentions(Ok(vec![
            user("b@macro.com").to_string(),
            user("c@macro.com").to_string(),
        ])),
        access,
    );

    let users = mentions
        .share_with_mentioned(AgentSessionId::TEST_A, Some(&user("a@macro.com")), "@b @c")
        .await
        .expect("mentions resolve");

    assert_eq!(users, vec![user("b@macro.com")]);
    assert!(access.granted().is_empty());
}

#[tokio::test]
async fn a_prompt_with_no_user_behind_it_shares_nothing() {
    let access = access(vec![(owner(), AccessLevel::Owner)]);
    let mentions = LexicalPromptMentions::new(
        FixedMentions(Ok(vec![
            user("owner@macro.com").to_string(),
            user("c@macro.com").to_string(),
        ])),
        access,
    );

    let users = mentions
        .share_with_mentioned(AgentSessionId::TEST_A, None, "@owner @c")
        .await
        .expect("mentions resolve");

    assert_eq!(users, vec![owner()]);
    assert!(access.granted().is_empty());
}

#[tokio::test]
async fn a_prompt_naming_nobody_never_touches_access() {
    struct Unreachable;
    impl SessionAccess for Unreachable {
        async fn viewers(
            &self,
            _session_id: AgentSessionId,
        ) -> Result<Vec<MacroUserIdStr<'static>>> {
            panic!("access should not be consulted for a prompt with no mentions")
        }
        async fn access_of(
            &self,
            _session_id: AgentSessionId,
            _user: &MacroUserIdStr<'static>,
        ) -> Result<Option<AccessLevel>> {
            panic!("access should not be consulted for a prompt with no mentions")
        }
        async fn grant_edit(
            &self,
            _session_id: AgentSessionId,
            _users: &[MacroUserIdStr<'static>],
        ) -> Result<()> {
            panic!("nothing should be granted for a prompt with no mentions")
        }
    }
    let mentions = LexicalPromptMentions::new(FixedMentions(Ok(Vec::new())), Unreachable);

    let users = mentions
        .share_with_mentioned(AgentSessionId::TEST_A, Some(&owner()), "no mentions here")
        .await
        .expect("mentions resolve");

    assert!(users.is_empty());
}

#[tokio::test]
async fn ids_that_are_not_macro_users_are_skipped() {
    let access = access(vec![(owner(), AccessLevel::Owner)]);
    let mentions = LexicalPromptMentions::new(
        FixedMentions(Ok(vec![
            "not-a-user-id".to_owned(),
            user("a@macro.com").to_string(),
        ])),
        access,
    );

    let users = mentions
        .share_with_mentioned(AgentSessionId::TEST_A, Some(&owner()), "@junk @a")
        .await
        .expect("mentions resolve");

    assert_eq!(users, vec![user("a@macro.com")]);
}

#[tokio::test]
async fn a_lexical_failure_is_an_error_not_an_empty_answer() {
    let mentions = LexicalPromptMentions::new(
        FixedMentions(Err(HarnessError::Mentions(rootcause::report!("down")))),
        access(vec![(owner(), AccessLevel::Owner)]),
    );

    let error = mentions
        .share_with_mentioned(AgentSessionId::TEST_A, Some(&owner()), "@a")
        .await
        .expect_err("the failure surfaces");

    assert!(matches!(error, HarnessError::Mentions(_)));
}
