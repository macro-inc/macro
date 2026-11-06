//! Building lifecycle-event identity from the session's own rows.

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::events::{SessionIdentity, ThreadOrigin};

use super::error::Result;
use super::model::{AgentSession, SessionBot};

/// The identity block every lifecycle event carries, from the session row,
/// its bot, and the users its log has attributed frames to.
///
/// The audience is `participants` plus the owner, who belongs on it whether
/// or not they have acted yet. The event names its owner as a user, so a
/// session owned by anything else has no identity here and is refused
/// rather than described as somebody it is not.
///
/// A thread origin needs all three of its ids. A session created from a
/// thread has them all; one created without a message has none. Anything in
/// between is a row this code does not know how to describe, so it is
/// reported as no origin rather than a half one.
pub fn session_identity(
    session: &AgentSession,
    bot: &SessionBot,
    participants: Vec<MacroUserIdStr<'static>>,
) -> Result<SessionIdentity> {
    let owner = session.owner_user()?;
    let visibility = match &session.thread_visibility {
        Some(visibility) => visibility.clone(),
        None => {
            return Err(super::error::AgentSessionError::Unknown(anyhow::anyhow!(
                "session root audience is unavailable"
            )));
        }
    };
    if let messages::domain::models::MessageVisibility::Private { user_id, .. } = &visibility
        && owner.as_ref() != user_id
    {
        return Err(super::error::AgentSessionError::Unknown(anyhow::anyhow!(
            "session owner does not match its private audience"
        )));
    }
    let mut audience = participants;
    if !audience.contains(owner) {
        audience.push(owner.clone());
    }
    let origin =
        match (
            session.thread_parent.as_ref(),
            session.thread_id,
            session.originating_message_id,
        ) {
            (Some(parent), Some(thread_id), Some(originating_message_id)) => Some(
                ThreadOrigin::new(parent.clone(), thread_id, originating_message_id),
            ),
            (None, None, None) => None,
            (parent, thread_id, originating_message_id) => {
                tracing::warn!(
                    session_id = %session.id,
                    ?parent,
                    ?thread_id,
                    ?originating_message_id,
                    "agent session has a partial thread origin; reporting none"
                );
                None
            }
        };
    Ok(SessionIdentity {
        session_id: session.id,
        session_name: session.name.clone(),
        bot_id: session.bot_id,
        bot_name: bot.name.clone(),
        owner_id: owner.clone(),
        origin,
        visibility,
        audience,
        source: session.source,
    })
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::domain::model::AgentSessionId;
    use messages::domain::models::MessageVisibility;

    #[test]
    fn lifecycle_identity_retains_private_audience_without_an_origin() {
        let mut session = crate::testing::test_agent_session(AgentSessionId::TEST_A);
        session.thread_id = Some(macro_uuid::Uuid::now_v7());
        session.thread_visibility = Some(MessageVisibility::Private {
            user_id: session.owner_user().unwrap().to_string(),
            bot_ids: vec![],
        });
        let bot = SessionBot {
            id: session.bot_id,
            name: "Agent".into(),
            handle: "agent".into(),
            avatar_url: None,
        };
        let identity = session_identity(&session, &bot, vec![]).unwrap();
        assert!(identity.origin.is_none());
        assert_eq!(Some(identity.visibility), session.thread_visibility);
        session.thread_visibility = None;
        assert!(session_identity(&session, &bot, vec![]).is_err());
        session.thread_visibility = Some(MessageVisibility::Private {
            user_id: "macro|other@example.com".into(),
            bot_ids: vec![],
        });
        assert!(session_identity(&session, &bot, vec![]).is_err());
    }
}
