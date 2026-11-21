//! What each Macro event means, for the MCP server's `events/list`: one
//! sentence per webhook event name, saying when it fires and what its `ids`
//! select.

#[cfg(test)]
#[path = "catalog_test.rs"]
mod test;

/// When `name` fires, or `None` for a name Macro does not emit.
#[must_use]
pub fn event_description(name: &str) -> Option<&'static str> {
    Some(match name {
        "document.created" => "A document was created. ids select documents.",
        "document.updated" => "A document's content or metadata changed. ids select documents.",
        "document.deleted" => "A document was deleted. ids select documents.",
        "document.copied" => "A document was copied. ids select the source documents.",
        "document.interaction" => {
            "Someone opened or otherwise interacted with a document. ids select documents."
        }
        "channel.created" => "A channel was created. ids select channels.",
        "channel.updated" => "A channel's name or settings changed. ids select channels.",
        "channel.deleted" => "A channel was deleted. ids select channels.",
        "channel.participant_added" => {
            "Someone joined or was added to a channel. ids select channels."
        }
        "channel.participant_removed" => {
            "Someone left or was removed from a channel. ids select channels."
        }
        "channel.access_requested" => {
            "Someone outside a private or team channel asked to join it. ids select channels."
        }
        "channel.picture_changed" => "A channel's picture changed. ids select channels.",
        "message.posted" => {
            "A message was posted in a channel or a document discussion. ids select the parent channel or document."
        }
        "message.patched" => "A message was edited. ids select the parent channel or document.",
        "message.deleted" => "A message was deleted. ids select the parent channel or document.",
        "message.attachment_created" => {
            "An attachment was added to a message. ids select the parent channel or document."
        }
        "message.attachment_removed" => {
            "An attachment was removed from a message. ids select the parent channel or document."
        }
        "message.mentioned" => {
            "A message @-mentioned a user, bot, document or other item; one event per mentioned item, sent to everyone who can read the message. ids select the parent channel or document."
        }
        "webhook.created" => "One of the workspace's webhooks was created.",
        "webhook.updated" => "One of the workspace's webhooks was changed.",
        "webhook.deleted" => "One of the workspace's webhooks was deleted.",
        "webhook.validated" => "One of the workspace's webhooks was validated.",
        "agent_trigger.new" => "A message asked a bot to start new work. ids select bots.",
        "agent_trigger.existing" => {
            "A message asked a bot to continue an existing session. ids select bots."
        }
        "agent_session.opened" => "An agent session was opened. ids select sessions.",
        "agent_session.turn_started" => "An agent session started a turn. ids select sessions.",
        "agent_session.turn_ended" => "An agent session finished a turn. ids select sessions.",
        "agent_session.command_rejected" => {
            "An agent session refused a command. ids select sessions."
        }
        "agent_session.settled" => {
            "An agent session finished its turn with nothing queued behind it. ids select sessions."
        }
        "agent_session.waiting_for_input" => {
            "An agent session is waiting for someone's input. ids select sessions."
        }
        "agent_session.input_received" => {
            "An agent session received the input it waited for. ids select sessions."
        }
        "agent_session.mentioned" => "An agent session was mentioned. ids select sessions.",
        "agent_session.stopped" => "An agent session stopped mid-turn. ids select sessions.",
        "agent_session.renamed" => "An agent session was renamed. ids select sessions.",
        "agent_session.deleted" => "An agent session was deleted. ids select sessions.",
        "user.picture_changed" => {
            "You or one of your contacts changed their profile picture. ids select users."
        }
        "call.started" => "A call started. ids select calls.",
        "call.ended" => "A call ended. ids select calls.",
        "call.participant_joined" => "Someone joined a call. ids select calls.",
        "call.participant_left" => "Someone left a call. ids select calls.",
        "call.recording_ready" => "A call's recording is ready. ids select calls.",
        "call.summarized" => "A call's summary is ready. ids select calls.",
        "call.ringing" => "A call is ringing you. ids select calls.",
        "call.answered" => "You answered a call. ids select calls.",
        "call.declined" => "You declined a call. ids select calls.",
        "call.invited" => "You were invited to a call. ids select calls.",
        "passwords.access_request.resolved" => {
            "Your request for access to a shared password was approved or denied."
        }
        _ => return None,
    })
}
