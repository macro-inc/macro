//! Slack `rich_text` blocks as the raw mrkdwn Macro stores for a message, for
//! messages whose `text` is empty (Slack's newer clients send only blocks).
//! The web renders mrkdwn; mentions come out as `<@U…>` like in `text`.

use slack_client::models::{
    Block, KnownBlock, RichTextElement, RichTextInline, RichTextListStyle, RichTextStyle,
};

#[cfg(test)]
mod test;

/// The message's rich text blocks as mrkdwn; blocks of other kinds are
/// skipped.
pub fn blocks_to_mrkdwn(blocks: &[Block]) -> String {
    let mut parts = Vec::new();
    for block in blocks {
        let Block::Known(KnownBlock::RichText { elements, .. }) = block else {
            continue;
        };
        for element in elements {
            let rendered = element_to_mrkdwn(element);
            if !rendered.is_empty() {
                parts.push(rendered);
            }
        }
    }
    parts.join("\n")
}

fn element_to_mrkdwn(element: &RichTextElement) -> String {
    match element {
        RichTextElement::RichTextSection { elements } => {
            inlines(elements).trim_end_matches('\n').to_owned()
        }
        RichTextElement::RichTextQuote { elements } => inlines(elements)
            .trim_end_matches('\n')
            .lines()
            .map(|line| format!("> {line}"))
            .collect::<Vec<_>>()
            .join("\n"),
        RichTextElement::RichTextPreformatted { elements } => {
            let code: String = elements.iter().map(plain).collect();
            format!("```\n{}\n```", code.trim_end_matches('\n'))
        }
        RichTextElement::RichTextList {
            style,
            indent,
            offset,
            elements,
        } => {
            let pad = "    ".repeat(usize::from(*indent));
            elements
                .iter()
                .enumerate()
                .map(|(index, item)| {
                    let marker = match style {
                        RichTextListStyle::Bullet => "•".to_owned(),
                        RichTextListStyle::Ordered => {
                            let number = u64::from(offset.unwrap_or(0)) + index as u64 + 1;
                            format!("{number}.")
                        }
                    };
                    format!("{pad}{marker} {}", element_to_mrkdwn(item))
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
    }
}

fn inlines(elements: &[RichTextInline]) -> String {
    elements.iter().map(inline).collect()
}

/// Escapes what mrkdwn would otherwise read as markup.
fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// `text` wrapped in the style's markers, keeping surrounding whitespace
/// outside them (Slack ignores `* bold*`).
fn styled(text: &str, style: Option<&RichTextStyle>) -> String {
    let Some(style) = style else {
        return text.to_owned();
    };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return text.to_owned();
    }
    let start = text.len() - text.trim_start().len();
    let end = start + trimmed.len();
    let mut inner = trimmed.to_owned();
    if style.code {
        inner = format!("`{inner}`");
    }
    if style.strike {
        inner = format!("~{inner}~");
    }
    if style.italic {
        inner = format!("_{inner}_");
    }
    if style.bold {
        inner = format!("*{inner}*");
    }
    format!("{}{inner}{}", &text[..start], &text[end..])
}

fn inline(element: &RichTextInline) -> String {
    match element {
        RichTextInline::Text { text, style } => styled(&escape(text), style.as_ref()),
        RichTextInline::Link { url, text, style } => {
            let link = match text.as_deref().filter(|text| !text.is_empty()) {
                Some(text) => format!("<{url}|{}>", escape(text)),
                None => format!("<{url}>"),
            };
            styled(&link, style.as_ref())
        }
        RichTextInline::User { user_id } => format!("<@{user_id}>"),
        RichTextInline::Usergroup { usergroup_id } => format!("<!subteam^{usergroup_id}>"),
        RichTextInline::Channel { channel_id } => format!("<#{channel_id}>"),
        RichTextInline::Team { team_id } => team_id.to_string(),
        RichTextInline::Emoji {
            name, skin_tone, ..
        } => match skin_tone {
            Some(tone) => format!(":{name}::skin-tone-{tone}:"),
            None => format!(":{name}:"),
        },
        RichTextInline::Broadcast { range } => format!("<!{range}>"),
        RichTextInline::Date {
            timestamp,
            format,
            fallback,
        } => format!(
            "<!date^{timestamp}^{format}|{}>",
            fallback.as_deref().unwrap_or_default()
        ),
        RichTextInline::Color { value } => value.clone(),
    }
}

/// An inline's text without markup, for preformatted blocks.
fn plain(element: &RichTextInline) -> String {
    match element {
        RichTextInline::Text { text, .. } => escape(text),
        RichTextInline::Link { url, text, .. } => text.clone().unwrap_or_else(|| url.clone()),
        other => inline(other),
    }
}
