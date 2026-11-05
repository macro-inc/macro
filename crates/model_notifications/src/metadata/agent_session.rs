//! Notifications about agent sessions: a turn ended, the agent is asking,
//! a prompt named someone.

use super::*;

#[cfg(test)]
mod test;

/// The most of an agent's prose a lock-screen alert or inbox row shows.
const AGENT_EXCERPT_MAX_CHARS: usize = 280;

/// The session an agent-session notification is about, and where its magic
/// chip lives when it was opened from a thread.
///
/// The conversation an agent session was opened from: a channel, document,
/// or initiative. Spelled like the message API's parent for client routing.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, ToSchema)]
pub struct AgentSessionOriginParent {
    /// `channel`, `document`, or `initiative`.
    #[serde(rename = "type")]
    pub kind: String,
    /// The parent entity id.
    pub id: String,
}

/// Flattened into each agent-session kind so the wire keeps these keys at the
/// top level of the metadata, the way [`CommonChannelMetadata`] does.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionNotificationRef {
    /// The session; what a click opens.
    pub session_id: Uuid,
    /// The session's name at the time of the event.
    pub session_name: String,
    /// The bot the session runs for. A string on the wire: system bots have
    /// fixed ids like `00000000-0000-0000-0000-00000000a2a2`, which are not
    /// RFC 4122 uuids and fail a `format: uuid` check on the client.
    #[schema(value_type = String)]
    pub bot_id: Uuid,
    /// The bot's display name; agent notifications have no user sender, so
    /// this is who they read as being from.
    pub bot_name: String,
    /// The channel or document the session was opened from, when it was.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<AgentSessionOriginParent>,
    /// The channel the session was opened from, when it was opened from a
    /// channel thread.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<Uuid>,
    /// The thread the session was opened from, when it was.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<Uuid>,
    /// The magic-chip message for the turn in question, when one was posted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub announcement_message_id: Option<Uuid>,
}

/// An agent finished a turn with nothing queued behind it.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSettledMetadata {
    #[serde(flatten)]
    pub session: AgentSessionNotificationRef,
    /// The turn that ended.
    pub turn: u32,
    /// Who prompted the turn, absent when a bot acted on nobody's behalf.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<String>)]
    pub actor: Option<MacroUserIdStr<'static>>,
    /// The ACP stop reason, or `error`.
    pub stop_reason: String,
    /// The agent's last prose in the turn, whole; `None` when it wrote none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub excerpt: Option<String>,
}

/// An agent is blocked on a question only the session's owner can answer.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionWaitingForInputMetadata {
    #[serde(flatten)]
    pub session: AgentSessionNotificationRef,
    /// The turn asking.
    pub turn: u32,
    /// The question, as the agent phrased it.
    pub question: String,
}

/// Someone named the recipient in a prompt to an agent session.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionMentionedMetadata {
    #[serde(flatten)]
    pub session: AgentSessionNotificationRef,
    /// Who wrote the prompt, absent when a bot acted on nobody's behalf.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<String>)]
    pub mentioned_by: Option<MacroUserIdStr<'static>>,
    /// The action carrying the prompt.
    pub action_id: Uuid,
}

impl Notification for AgentSessionSettledMetadata {
    const TYPE_NAME: &'static str = "agent_session_settled";
}

impl Notification for AgentSessionWaitingForInputMetadata {
    const TYPE_NAME: &'static str = "agent_session_waiting_for_input";
}

impl Notification for AgentSessionMentionedMetadata {
    const TYPE_NAME: &'static str = "agent_session_mentioned";
}

/// The first `AGENT_EXCERPT_MAX_CHARS` of an agent's prose, on one line, with
/// its Macro mention tags replaced by the names they show, as channel alerts
/// do for messages.
fn agent_excerpt(text: &str) -> String {
    let plain = PlainTextFormatter::format_xml_text(ParsedXmlText::parse_lenient(text)).0;
    let flat = plain.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= AGENT_EXCERPT_MAX_CHARS {
        return flat;
    }
    let mut cut: String = flat.chars().take(AGENT_EXCERPT_MAX_CHARS - 1).collect();
    cut.push('…');
    cut
}

/// How a turn ended, as the "settled" alert tells it apart at a glance.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TurnEnding {
    Finished,
    Stopped,
    HitLimit,
    Declined,
    Failed,
}

impl TurnEnding {
    /// Read from the ACP stop reason. A reason ACP adds later reads as
    /// finished: the turn ended without the runtime reporting a failure.
    fn from_stop_reason(stop_reason: &str) -> Self {
        match stop_reason {
            "cancelled" => Self::Stopped,
            "max_tokens" | "max_turn_requests" => Self::HitLimit,
            "refusal" => Self::Declined,
            "error" => Self::Failed,
            _ => Self::Finished,
        }
    }

    fn verb(self) -> &'static str {
        match self {
            Self::Finished => "finished",
            Self::Stopped => "was stopped",
            Self::HitLimit => "hit its limit",
            Self::Declined => "declined",
            Self::Failed => "ran into an error",
        }
    }

    /// The body when the turn wrote no prose to quote.
    fn without_prose(self) -> &'static str {
        match self {
            Self::Finished => "Open the session to see what it did.",
            Self::Stopped => "It stopped before finishing.",
            Self::HitLimit => "It stopped before finishing. Open the session to continue.",
            Self::Declined => "It declined to continue.",
            Self::Failed => "Open the session to see what went wrong.",
        }
    }
}

/// An alert title: what happened, then which session it happened in, so a
/// truncated title still says what happened.
fn session_title(session: &AgentSessionNotificationRef, happened: &str) -> String {
    let name = session.session_name.trim();
    if name.is_empty() {
        return format!("{} {happened}", session.bot_name);
    }
    format!("{} {happened} · {name}", session.bot_name)
}

impl NotificationTitle for AgentSessionSettledMetadata {
    fn format_title(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let ending = TurnEnding::from_stop_reason(&self.stop_reason);
        Ok(session_title(&self.session, ending.verb()))
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let excerpt = self
            .excerpt
            .as_deref()
            .map(agent_excerpt)
            .filter(|excerpt| !excerpt.is_empty());
        Ok(excerpt.unwrap_or_else(|| {
            TurnEnding::from_stop_reason(&self.stop_reason)
                .without_prose()
                .to_owned()
        }))
    }
}

impl NotificationTitle for AgentSessionWaitingForInputMetadata {
    fn format_title(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        Ok(session_title(&self.session, "needs an answer"))
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        Ok(agent_excerpt(&self.question))
    }
}

impl NotificationTitle for AgentSessionMentionedMetadata {
    fn format_title(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        Ok(match &self.mentioned_by {
            Some(author) => format!(
                "{} mentioned you in {}",
                author.email_part().local_part(),
                self.session.session_name
            ),
            None => format!("You were mentioned in {}", self.session.session_name),
        })
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        Ok(format!("An agent session with {}", self.session.bot_name))
    }
}

/// The alert for an agent-session kind: title and body from the metadata,
/// grouped with the chip's thread on the lock screen when there is one.
fn agent_session_apns<T: NotificationTitle>(
    notif: &T,
    session: &AgentSessionNotificationRef,
    sender_id: Option<MacroUserIdStr<'_>>,
    notification_id: Uuid,
) -> Option<APNSPushNotification<PushNotificationData>> {
    let mut apns = alert_apns(notif, sender_id, notification_id, None).ok()?;
    apns.aps.thread_id = session.thread_id.map(|thread| thread.to_string());
    Some(apns)
}

impl NotificationExtIos for AgentSessionSettledMetadata {
    type NotifData = PushNotificationData;

    fn collapse_key(&self, _entity: &Entity<'_>) -> NotifCollapseKey {
        // One alert per session: the next turn's replaces the last one's.
        NotifCollapseKey::new(Self::TYPE_NAME).append(&self.session.session_id.to_string())
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        agent_session_apns(self, &self.session, sender_id, notification_id)
    }
}

impl NotificationExtIos for AgentSessionWaitingForInputMetadata {
    type NotifData = PushNotificationData;

    fn collapse_key(&self, _entity: &Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new(Self::TYPE_NAME).append(&self.session.session_id.to_string())
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let mut apns = agent_session_apns(self, &self.session, sender_id, notification_id)?;
        // A machine is blocked on a person: worth breaking through Focus.
        apns.aps.interruption_level = Some(InterruptionLevel::TimeSensitive);
        Some(apns)
    }
}

impl NotificationExtIos for AgentSessionMentionedMetadata {
    type NotifData = PushNotificationData;

    fn collapse_key(&self, _entity: &Entity<'_>) -> NotifCollapseKey {
        // Each prompt that names you is its own alert.
        NotifCollapseKey::new(Self::TYPE_NAME).append(&self.action_id.to_string())
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        agent_session_apns(self, &self.session, sender_id, notification_id)
    }
}
