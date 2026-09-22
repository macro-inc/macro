//! Server-side "remove link preview" content transform.
//!
//! Preview suppression is a property of the link node itself: `preview:
//! false` inside the `<m-link>` JSON payload. This module rewrites message
//! content to set that flag for one URL. It runs only server-side (behind
//! the message-patch permission check) so clients never submit content for
//! this operation — which is what makes skipping `edited_at` safe.

#[cfg(test)]
mod test;

const M_LINK_OPEN: &str = "<m-link>";
const M_LINK_CLOSE: &str = "</m-link>";

fn m_link(url: &str, text: &str) -> String {
    // Literal construction keeps the editor's canonical field order
    // (serde_json's Map would alphabetize); Value::from handles escaping.
    format!(
        r#"{M_LINK_OPEN}{{"url":{},"text":{},"title":"","preview":false}}{M_LINK_CLOSE}"#,
        serde_json::Value::from(url),
        serde_json::Value::from(text),
    )
}

/// Sets `preview: false` inside one m-link payload by string surgery, so the
/// author's field order and formatting survive untouched.
fn suppress_payload(payload: &str) -> String {
    if payload.contains("\"preview\":false") || payload.contains("\"preview\": false") {
        return payload.to_string();
    }
    if payload.contains("\"preview\":true") || payload.contains("\"preview\": true") {
        return payload
            .replace("\"preview\":true", "\"preview\":false")
            .replace("\"preview\": true", "\"preview\": false");
    }
    match payload.trim_end().strip_suffix('}') {
        Some(rest) => format!("{rest},\"preview\":false}}"),
        None => payload.to_string(),
    }
}

fn payload_targets_url(payload: &str, url: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(payload)
        .ok()
        .and_then(|v| v.get("url").and_then(|u| u.as_str().map(|u| u == url)))
        .unwrap_or(false)
}

/// Rebuilds `content` from its alternating segments: text outside any
/// `<m-link>` tag, and the JSON payload inside one. Splitting once is what
/// keeps payload-internal text (a URL quoted in another link's label) from
/// ever being treated as a rewritable occurrence.
fn map_segments(
    content: &str,
    mut on_outside: impl FnMut(&str) -> String,
    mut on_payload: impl FnMut(&str) -> String,
) -> String {
    let mut out = String::with_capacity(content.len());
    let mut rest = content;
    loop {
        let Some(open) = rest.find(M_LINK_OPEN) else {
            out.push_str(&on_outside(rest));
            return out;
        };
        let after_open = &rest[open + M_LINK_OPEN.len()..];
        // An unclosed tag is not a link node; treat the remainder as text.
        let Some(close) = after_open.find(M_LINK_CLOSE) else {
            out.push_str(&on_outside(rest));
            return out;
        };
        out.push_str(&on_outside(&rest[..open]));
        out.push_str(M_LINK_OPEN);
        out.push_str(&on_payload(&after_open[..close]));
        out.push_str(M_LINK_CLOSE);
        rest = &after_open[close + M_LINK_CLOSE.len()..];
    }
}

/// Applies a transform outside code delimited like the frontend extractor:
/// triple-backtick fences (including unclosed fences), then single-backtick
/// spans without newlines. Code is copied byte-for-byte, including m-link tags.
fn map_outside_code(
    content: &str,
    delimiter: &str,
    mut transform: impl FnMut(&str) -> String,
) -> String {
    let mut out = String::with_capacity(content.len());
    let mut rest = content;
    while let Some(open) = rest.find(delimiter) {
        let after_open = &rest[open + delimiter.len()..];
        let close = after_open.find(delimiter);
        if delimiter == "`" && close.is_none_or(|end| after_open[..end].contains('\n')) {
            // This is an unmatched inline delimiter, not a code span.
            out.push_str(&transform(&rest[..open + delimiter.len()]));
            rest = after_open;
            continue;
        }
        out.push_str(&transform(&rest[..open]));
        let end = close.map_or(rest.len(), |close| open + delimiter.len() * 2 + close);
        out.push_str(&rest[open..end]);
        rest = &rest[end..];
    }
    out.push_str(&transform(rest));
    out
}

/// Matches `trimBareUrl` in the frontend preview extractor. Only sentence
/// punctuation and unmatched closing parentheses are outside the URL.
fn trim_bare_url(mut url: &str) -> &str {
    loop {
        let next = url.trim_end_matches(['.', ',', ';', ':', '!', '?', '\'', '"', '”', '’']);
        if next.ends_with(')') && next.matches(')').count() > next.matches('(').count() {
            url = &next[..next.len() - 1];
            continue;
        }
        if next == url {
            return next;
        }
        url = next;
    }
}

/// Wraps stand-alone occurrences of `url` in a segment of plain text — both
/// `[label](url)` markdown links and bare tokens — into suppressed m-links.
fn wrap_plain_occurrences(segment: &str, url: &str) -> String {
    if url.is_empty() {
        return segment.to_string();
    }
    let mut out = String::with_capacity(segment.len());
    let mut rest = segment;
    while let Some(pos) = rest.find(url) {
        let before = &rest[..pos];
        let after = &rest[pos + url.len()..];

        // Markdown form: before ends with "](", label sits between "[".."](".
        if before.ends_with("](") && after.starts_with(')') {
            let head = &before[..before.len() - 2];
            if let Some(open_bracket) = head.rfind('[') {
                let label = &head[open_bracket + 1..];
                if !label.contains(']') {
                    out.push_str(&head[..open_bracket]);
                    out.push_str(&m_link(url, if label.is_empty() { url } else { label }));
                    rest = &after[1..];
                    continue;
                }
            }
        }

        // Compare the entire bare token after the extractor's punctuation
        // trimming, so URL suffixes such as `.json` or `?q=1` stay untouched.
        let boundary_before = before
            .chars()
            .next_back()
            .is_none_or(|c| c.is_whitespace() || c == '(');
        let token = &rest[pos..];
        let token_end = token
            .find(|c: char| c.is_whitespace() || c == '<' || c == '>')
            .unwrap_or(token.len());
        let boundary_after = trim_bare_url(&token[..token_end]) == url;
        out.push_str(before);
        if boundary_before && boundary_after {
            out.push_str(&m_link(url, url));
        } else {
            out.push_str(url);
        }
        rest = after;
    }
    out.push_str(rest);
    out
}

/// Rewrites `content` so every link pointing at `url` stops rendering a rich
/// preview: matching `<m-link>` payloads gain `preview: false`, and (in
/// bot/API-authored content) markdown links and bare occurrences are wrapped
/// into an equivalent suppressed m-link. Idempotent, and a no-op when the
/// URL does not appear outside of other links' payload text.
pub fn remove_link_preview_from_content(content: &str, url: &str) -> String {
    if url.is_empty() {
        return content.to_string();
    }
    map_outside_code(content, "```", |outside_fences| {
        map_outside_code(outside_fences, "`", |outside_code| {
            map_segments(
                outside_code,
                |outside| wrap_plain_occurrences(outside, url),
                |payload| {
                    if payload_targets_url(payload, url) {
                        suppress_payload(payload)
                    } else {
                        payload.to_string()
                    }
                },
            )
        })
    })
}
