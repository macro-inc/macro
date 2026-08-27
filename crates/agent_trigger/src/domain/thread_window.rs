//! Thread context around the points where an agent was addressed.

use std::fmt::Write as _;

use bot_id::BotId;
use channel_sender::ChannelSender;
use chrono::{DateTime, Utc};
use macro_uuid::Uuid;

#[cfg(test)]
mod test;

/// One message of a thread.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThreadMessage {
    /// Message id.
    pub id: Uuid,
    /// Who posted it.
    pub sender: ChannelSender<'static>,
    /// Message body.
    pub content: String,
    /// When it was posted.
    pub created_at: DateTime<Utc>,
}

/// A transcript entry: a kept message, or a note that some were dropped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TranscriptEntry<'a> {
    /// A message inside one of the windows.
    Message(&'a ThreadMessage),
    /// Messages between two windows, or before the first one.
    Elided {
        /// How many were dropped.
        count: usize,
    },
}

/// Messages within `radius` of any of `anchors`, oldest first, capped to the
/// `cap` most recent.
///
/// Overlapping windows merge, and every gap between kept messages becomes an
/// [`TranscriptEntry::Elided`] so a reader can tell the thread is not
/// contiguous. Anchors not present in `messages` are ignored; empty when none
/// of them are.
#[must_use]
pub fn thread_window<'a>(
    messages: &'a [ThreadMessage],
    anchors: &[Uuid],
    radius: usize,
    cap: usize,
) -> Vec<TranscriptEntry<'a>> {
    let anchored = messages
        .iter()
        .enumerate()
        .filter(|(_, message)| anchors.contains(&message.id));

    let mut kept: Vec<usize> = Vec::new();
    for (index, _) in anchored {
        let start = index.saturating_sub(radius);
        let end = (index + radius).min(messages.len().saturating_sub(1));
        kept.extend(start..=end);
    }
    kept.sort_unstable();
    kept.dedup();
    if kept.is_empty() {
        return Vec::new();
    }
    // Oldest first out, so the cap keeps the context nearest the message being
    // evaluated rather than the oldest mention in the thread.
    if kept.len() > cap {
        kept.drain(..kept.len() - cap);
    }

    let mut entries = Vec::with_capacity(kept.len() + 1);
    let mut previous: Option<usize> = None;
    for index in kept {
        let gap = match previous {
            Some(previous) => index - previous - 1,
            None => index,
        };
        if gap > 0 {
            entries.push(TranscriptEntry::Elided { count: gap });
        }
        entries.push(TranscriptEntry::Message(&messages[index]));
        previous = Some(index);
    }
    entries
}

/// Renders a transcript for a judge reading the thread, labelling `agent`'s own
/// messages so it can tell which participant it is deciding about.
///
/// Other bots keep their raw ids: a second bot in the thread is a participant
/// like any other, and mislabelling it as the agent would invite the judge to
/// answer about the wrong one.
#[must_use]
pub fn render_transcript(entries: &[TranscriptEntry<'_>], agent: BotId) -> String {
    let agent = agent.into_storage_id();
    let mut rendered = String::new();
    for entry in entries {
        match entry {
            TranscriptEntry::Elided { count } => {
                let plural = if *count == 1 { "" } else { "s" };
                let _ = writeln!(rendered, "({count} earlier message{plural} hidden)");
            }
            TranscriptEntry::Message(message) => {
                let speaker = match (message.sender.as_bot(), message.sender.as_user()) {
                    (Some(bot), _) if bot.as_ref() == agent.as_ref() => "agent".to_owned(),
                    (Some(bot), _) => format!("bot {bot}"),
                    (None, Some(user)) => format!("user {user}"),
                    // A sender is one or the other; a future third kind should
                    // still appear in the transcript rather than vanish.
                    (None, None) => "unknown".to_owned(),
                };
                let _ = writeln!(rendered, "[{speaker}] {}", message.content);
            }
        }
    }
    rendered
}
