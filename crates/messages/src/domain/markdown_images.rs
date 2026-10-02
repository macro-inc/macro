//! Lift Markdown images out of message bodies onto the attachment path.
//!
//! Channel messages store images as `static/image` attachments, the same
//! shape a human upload uses. Inline `![alt](url)` and `<m-image>` nodes are
//! stripped from the body so they are not rendered as Markdown images.

/// A Macro static file referenced from stripped Markdown.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiftedStaticImage {
    /// Static file UUID from `/file/<id>` in the image URL.
    pub id: uuid::Uuid,
    /// Width from `<m-image>` JSON when it is a positive pixel count.
    pub width: Option<i32>,
    /// Height from `<m-image>` JSON when it is a positive pixel count.
    pub height: Option<i32>,
}

/// Body after Markdown images were removed, plus the static files they named.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiftedInlineImages {
    /// Message body with image markup removed.
    pub content: String,
    /// Distinct Macro static images, in document order.
    pub images: Vec<LiftedStaticImage>,
}

/// Remove Markdown images from `content` and collect Macro static file IDs.
///
/// Images inside fenced code blocks are left untouched. External URLs are
/// stripped and not returned: they cannot become `static/image` attachments.
#[must_use]
pub fn lift_inline_images(content: &str) -> LiftedInlineImages {
    let mut out = String::with_capacity(content.len());
    let mut images = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut in_fence = false;

    for line in content.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            out.push_str(line);
            continue;
        }
        if in_fence {
            out.push_str(line);
            continue;
        }
        out.push_str(&strip_line(line, &mut images, &mut seen));
    }

    LiftedInlineImages {
        content: collapse_blank_lines(&out),
        images,
    }
}

fn strip_line(
    line: &str,
    images: &mut Vec<LiftedStaticImage>,
    seen: &mut std::collections::HashSet<uuid::Uuid>,
) -> String {
    let mut remaining = line;
    let mut rebuilt = String::with_capacity(line.len());
    while !remaining.is_empty() {
        match next_image(remaining) {
            Some((range, image)) => {
                rebuilt.push_str(&remaining[..range.start]);
                if let Some(image) = image
                    && seen.insert(image.id)
                {
                    images.push(image);
                }
                remaining = &remaining[range.end..];
            }
            None => {
                rebuilt.push_str(remaining);
                break;
            }
        }
    }
    let newline = rebuilt.ends_with('\n');
    let mut rebuilt: String = rebuilt.split_whitespace().collect::<Vec<_>>().join(" ");
    if rebuilt.is_empty() {
        if newline {
            "\n".to_owned()
        } else {
            String::new()
        }
    } else {
        if newline {
            rebuilt.push('\n');
        }
        rebuilt
    }
}

fn next_image(input: &str) -> Option<(std::ops::Range<usize>, Option<LiftedStaticImage>)> {
    let markdown = input.find("![").map(|start| (start, "markdown"));
    let constrained = input.find("<m-image>").map(|start| (start, "constrained"));
    match (markdown, constrained) {
        (Some((md, _)), Some((m, _))) if m < md => parse_constrained(input, m),
        (Some((md, _)), _) => parse_markdown_image(input, md),
        (None, Some((m, _))) => parse_constrained(input, m),
        (None, None) => None,
    }
}

fn parse_markdown_image(
    input: &str,
    start: usize,
) -> Option<(std::ops::Range<usize>, Option<LiftedStaticImage>)> {
    let after_bang = start + 2;
    let alt_end = after_bang + input[after_bang..].find("](")?;
    let url_start = alt_end + 2;
    let url_end = url_start + input[url_start..].find(')')?;
    let url = input[url_start..url_end]
        .split_whitespace()
        .next()
        .unwrap_or("");
    Some((
        start..url_end + 1,
        static_file_id(url).map(|id| LiftedStaticImage {
            id,
            width: None,
            height: None,
        }),
    ))
}

fn parse_constrained(
    input: &str,
    start: usize,
) -> Option<(std::ops::Range<usize>, Option<LiftedStaticImage>)> {
    const OPEN: &str = "<m-image>";
    const CLOSE: &str = "</m-image>";
    let inner_start = start + OPEN.len();
    let inner_end = inner_start + input[inner_start..].find(CLOSE)?;
    let payload = &input[inner_start..inner_end];
    let end = inner_end + CLOSE.len();
    let parsed = serde_json::from_str::<serde_json::Value>(payload).ok();
    let url = parsed
        .as_ref()
        .and_then(|value| value.get("url"))
        .and_then(|url| url.as_str())
        .unwrap_or("");
    let width = positive_i32(parsed.as_ref().and_then(|value| value.get("width")));
    let height = positive_i32(parsed.as_ref().and_then(|value| value.get("height")));
    Some((
        start..end,
        static_file_id(url).map(|id| LiftedStaticImage { id, width, height }),
    ))
}

fn positive_i32(value: Option<&serde_json::Value>) -> Option<i32> {
    let number = value?
        .as_i64()
        .or_else(|| value?.as_u64().map(|n| n as i64))?;
    let number = i32::try_from(number).ok()?;
    (number > 0).then_some(number)
}

fn static_file_id(url: &str) -> Option<uuid::Uuid> {
    let marker = "/file/";
    let start = url.find(marker)? + marker.len();
    let id = url[start..]
        .split(|c| c == '?' || c == '#' || c == '/')
        .next()
        .unwrap_or("");
    uuid::Uuid::parse_str(id).ok()
}

fn collapse_blank_lines(content: &str) -> String {
    let mut collapsed = String::with_capacity(content.len());
    let mut blank_run = 0;
    for line in content.split_inclusive('\n') {
        if line.trim().is_empty() {
            blank_run += 1;
            if blank_run <= 1 {
                collapsed.push_str(if line.ends_with('\n') { "\n" } else { line });
            }
        } else {
            blank_run = 0;
            collapsed.push_str(line);
        }
    }
    collapsed.trim_matches('\n').to_owned()
}

#[cfg(test)]
mod test {
    use super::*;

    fn id() -> uuid::Uuid {
        uuid::Uuid::from_u128(0x0123_4567_89ab_cdef_0123_4567_89ab_cdef)
    }

    fn url() -> String {
        format!("https://static.macro.com/file/{}", id())
    }

    #[test]
    fn lifts_a_markdown_image_and_leaves_the_prose() {
        let lifted = lift_inline_images(&format!("Here you go.\n\n![]({})\n\nEnjoy.", url()));
        assert_eq!(lifted.content, "Here you go.\n\nEnjoy.");
        assert_eq!(
            lifted.images,
            vec![LiftedStaticImage {
                id: id(),
                width: None,
                height: None,
            }]
        );
    }

    #[test]
    fn image_only_content_becomes_empty() {
        let lifted = lift_inline_images(&format!("![cat]({})", url()));
        assert_eq!(lifted.content, "");
        assert_eq!(lifted.images[0].id, id());
    }

    #[test]
    fn strips_external_images_without_attaching_them() {
        let lifted = lift_inline_images("See ![x](https://example.com/cat.png)");
        assert_eq!(lifted.content, "See");
        assert!(lifted.images.is_empty());
    }

    #[test]
    fn lifts_constrained_images_with_stored_dimensions() {
        let payload = serde_json::json!({
            "url": url(),
            "alt": "",
            "width": 0,
            "height": 0,
            "constrainedWidth": 800,
            "constrainedHeight": 600,
        });
        let content = format!("<m-image>{payload}</m-image>");
        let lifted = lift_inline_images(&content);
        assert_eq!(lifted.content, "");
        assert_eq!(lifted.images[0].id, id());
        assert_eq!(lifted.images[0].width, None);
        assert_eq!(lifted.images[0].height, None);
    }

    #[test]
    fn uses_positive_pixel_size_from_m_image() {
        let payload = serde_json::json!({
            "url": url(),
            "width": 1024,
            "height": 768,
        });
        let lifted = lift_inline_images(&format!("<m-image>{payload}</m-image>"));
        assert_eq!(lifted.images[0].width, Some(1024));
        assert_eq!(lifted.images[0].height, Some(768));
    }

    #[test]
    fn ignores_images_inside_fenced_code() {
        let content = format!("```\n![]({})\n```\n\nDone.", url());
        let lifted = lift_inline_images(&content);
        assert_eq!(lifted.content, content);
        assert!(lifted.images.is_empty());
    }

    #[test]
    fn deduplicates_the_same_static_file() {
        let content = format!("![]({0})\n\n![]({0})", url());
        let lifted = lift_inline_images(&content);
        assert_eq!(lifted.images.len(), 1);
    }

    #[test]
    fn reads_a_file_id_from_a_sized_url() {
        assert_eq!(
            static_file_id(&format!("{}/file/{}?size=1080", "https://cdn", id())),
            Some(id())
        );
    }
}
