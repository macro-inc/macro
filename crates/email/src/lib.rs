pub mod domain;
#[cfg(feature = "inbound")]
pub mod inbound;
#[cfg(any(feature = "outbound", feature = "http_client", feature = "s3"))]
pub mod outbound;
#[cfg(test)]
pub(crate) mod telemetry_capture;
pub mod trace_context;

/// Why a channel-mention bot's program may not send at all: its direct tools
/// never could, and a quoted approval it writes itself proves nothing.
pub const CHANNEL_MENTION_SEND_REFUSAL: &str = "Email cannot be sent, forwarded or scheduled from a channel or document mention. Write the email out in your reply instead, and tell the user to send it from Macro's composer or from an agent session.";

/// Whether the current request comes from a program answering a channel
/// mention, per its signed token claim (`agent_correlation` propagates it).
pub fn is_channel_mention_run() -> bool {
    agent_correlation::context::current_channel_mention().is_some()
}
