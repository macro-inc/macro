//! How many agents in a row handed a conversation to one another.

use channel_sender::ChannelSender;

#[cfg(test)]
mod test;

/// Most agent-to-agent hops one person's message can set off. Three covers
/// a handoff, the answer back, and one more round; a fourth agent turn with
/// nobody stepping in is far likelier a loop than a plan, and every hop
/// bills the attributed user.
pub const MAX_AGENT_HOPS: usize = 3;

/// Agent hops leading to the last of `senders`, a thread read oldest first
/// through the prompt: each change of bot author since the last message by
/// anyone else counts one. A human post starts the count over.
///
/// Messages by one bot in a row (its session announcement and its reply)
/// are a single hop.
#[must_use]
pub fn agent_hops<'a>(senders: impl DoubleEndedIterator<Item = &'a ChannelSender<'a>>) -> usize {
    let mut hops = 0;
    let mut previous = None;
    for sender in senders.rev() {
        let Some(bot) = sender.as_bot() else {
            break;
        };
        if previous != Some(bot) {
            hops += 1;
            previous = Some(bot);
        }
    }
    hops
}
