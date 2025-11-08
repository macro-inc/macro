pub const DEFAULT_CHAT_NAME: &str = "New Chat";
pub const DEFAULT_MAX_TOKENS: u32 = 16000;

/// Default batch size for querying documents from rds
pub const DEFAULT_DOCUMENT_BATCH_LIMIT: i64 = 1000;

/// max token size openai image
pub const DEFAULT_IMAGE_TOKENS: i64 = 1105;

pub const DEFAULT_CHANNEL_TOKENS: i64 = 5000;

pub const DEFAULT_EMAIL_TOKENS: i64 = 3000;

/// The transcript will include messages up to the smaller of
/// CHANNEL_TRANSCRIPT_MAX_MESSAGES or CHANNEL_TRANSCRIPT_MAX_DAYS
/// Maximum number of messages to include in a channel transcript (hard cap)
pub const CHANNEL_TRANSCRIPT_MAX_MESSAGES: i64 = 1000;
