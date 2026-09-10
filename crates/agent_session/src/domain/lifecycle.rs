//! Building lifecycle-event identity from the session's own rows.

use crate::domain::events::{SessionIdentity, ThreadOrigin};

use super::model::{AgentSession, SessionBot};

/// The identity block every lifecycle event carries, from the session row
/// and its bot.
///
/// A thread origin needs all three of its ids. A session created from a
/// thread has them all; one created without a message has none. Anything in
/// between is a row this code does not know how to describe, so it is
/// reported as no origin rather than a half one.
#[must_use]
pub fn session_identity(session: &AgentSession, bot: &SessionBot) -> SessionIdentity {
    let origin = match (
        session.thread_channel_id,
        session.thread_id,
        session.originating_message_id,
    ) {
        (Some(channel_id), Some(thread_id), Some(originating_message_id)) => Some(ThreadOrigin {
            channel_id,
            thread_id,
            originating_message_id,
        }),
        (None, None, None) => None,
        (channel_id, thread_id, originating_message_id) => {
            tracing::warn!(
                session_id = %session.id,
                ?channel_id,
                ?thread_id,
                ?originating_message_id,
                "agent session has a partial thread origin; reporting none"
            );
            None
        }
    };
    SessionIdentity {
        session_id: session.id,
        session_name: session.name.clone(),
        bot_id: session.bot_id,
        bot_name: bot.name.clone(),
        owner_id: session.owner_id.clone(),
        origin,
    }
}
