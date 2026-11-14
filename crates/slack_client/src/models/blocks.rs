use serde::{Deserialize, Serialize};

use crate::ids::{ChannelId, TeamId, UserGroupId, UserId};

/// A layout block. `rich_text` (what clients compose) is typed; any other
/// block, or a `rich_text` with an element this client doesn't know, is kept
/// as raw JSON so nothing is lost and callers fall back to the message text.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(untagged)]
pub enum Block {
    /// A block this client models.
    Known(KnownBlock),
    /// Anything else, verbatim.
    Other(serde_json::Value),
}

/// The blocks this client models.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum KnownBlock {
    /// Formatted text as composed in a Slack client.
    RichText {
        /// Slack's block id.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        block_id: Option<String>,
        /// Paragraphs, lists, quotes and code blocks.
        elements: Vec<RichTextElement>,
    },
}

/// A top-level element of a `rich_text` block.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RichTextElement {
    /// A paragraph.
    RichTextSection {
        /// Inline content.
        elements: Vec<RichTextInline>,
    },
    /// A bulleted or numbered list; each element is one item.
    RichTextList {
        /// Bullets or numbers.
        style: RichTextListStyle,
        /// Nesting depth.
        #[serde(default)]
        indent: u8,
        /// Number of the first item minus one, for split ordered lists.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        offset: Option<u32>,
        /// Items.
        elements: Vec<RichTextElement>,
    },
    /// A block quote.
    RichTextQuote {
        /// Inline content.
        elements: Vec<RichTextInline>,
    },
    /// A code block.
    RichTextPreformatted {
        /// Inline content.
        elements: Vec<RichTextInline>,
    },
}

/// List style.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RichTextListStyle {
    /// Bulleted.
    Bullet,
    /// Numbered.
    Ordered,
}

/// Inline content of a rich text element.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RichTextInline {
    /// Plain text.
    Text {
        /// The text.
        text: String,
        /// Formatting.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        style: Option<RichTextStyle>,
    },
    /// A link.
    Link {
        /// Target.
        url: String,
        /// Label, when it differs from the URL.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<String>,
        /// Formatting.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        style: Option<RichTextStyle>,
    },
    /// A user mention.
    User {
        /// The user.
        user_id: UserId,
    },
    /// A user group mention.
    Usergroup {
        /// The group.
        usergroup_id: UserGroupId,
    },
    /// A channel mention.
    Channel {
        /// The channel.
        channel_id: ChannelId,
    },
    /// A team mention.
    Team {
        /// The team.
        team_id: TeamId,
    },
    /// An emoji.
    Emoji {
        /// Name without colons.
        name: String,
        /// Code points for standard emoji (`1f604`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        unicode: Option<String>,
        /// Skin tone 2–6.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        skin_tone: Option<u8>,
    },
    /// `@here`, `@channel` or `@everyone`.
    Broadcast {
        /// `here`, `channel` or `everyone`.
        range: String,
    },
    /// A date rendered in the reader's time zone.
    Date {
        /// Unix seconds.
        timestamp: i64,
        /// Slack's date format string.
        format: String,
        /// Text when the format can't be rendered.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fallback: Option<String>,
    },
    /// A color swatch.
    Color {
        /// Hex value.
        value: String,
    },
}

/// Inline formatting.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
pub struct RichTextStyle {
    /// Bold.
    #[serde(default, skip_serializing_if = "is_false")]
    pub bold: bool,
    /// Italic.
    #[serde(default, skip_serializing_if = "is_false")]
    pub italic: bool,
    /// Strikethrough.
    #[serde(default, skip_serializing_if = "is_false")]
    pub strike: bool,
    /// Inline code.
    #[serde(default, skip_serializing_if = "is_false")]
    pub code: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}
