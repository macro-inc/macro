//! Convert authorized tool output into MCP text, images, and media links.

use crate::markdown_images::{MarkdownImageResolver, tool_result_with_images};
use futures::future::join_all;
use macro_user_id::user_id::MacroUserIdStr;
use rmcp::model::{CallToolResult, Content, RawResource};
use serde_json::Value;
use std::collections::HashSet;
use std::time::Duration;
use url::Url;

#[cfg(test)]
mod test;

const MAX_CHANNEL_IMAGES: usize = 8;
const CHANNEL_IMAGE_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy)]
enum MediaKind {
    Image,
    Video,
}

struct ChannelMedia {
    kind: MediaKind,
    entity_id: String,
    url: String,
}

/// Called only after the tool has authorized and successfully read its data.
pub(crate) async fn tool_result_with_media<R: MarkdownImageResolver>(
    resolver: &R,
    user_id: &MacroUserIdStr<'_>,
    tool_name: &str,
    static_file_base_url: &Url,
    mut value: Value,
) -> CallToolResult {
    if !matches!(
        tool_name,
        "ReadChannelMessages" | "ReadChannelThread" | "ReadChannelMessageContext"
    ) {
        return tool_result_with_images(resolver, user_id, value).await;
    }

    let mut media = Vec::new();
    add_media_urls(
        &mut value,
        static_file_base_url,
        &mut HashSet::new(),
        &mut media,
    );

    // Build both JSON representations after enrichment so text-only clients
    // also receive the URLs, including images beyond the inline image budget.
    let mut result = CallToolResult::structured(value);
    let mut image_resolutions = Vec::new();
    for attachment in media {
        match attachment.kind {
            MediaKind::Image if image_resolutions.len() < MAX_CHANNEL_IMAGES => {
                image_resolutions.push(async move {
                    let image = tokio::time::timeout(
                        CHANNEL_IMAGE_TIMEOUT,
                        resolver.resolve_channel_image(&attachment.url),
                    )
                    .await
                    .ok()
                    .flatten()?;
                    Some((attachment, image))
                });
            }
            MediaKind::Image => {}
            MediaKind::Video => {
                result.content.push(Content::resource_link(
                    RawResource::new(
                        attachment.url,
                        format!("Channel video attachment {}", attachment.entity_id),
                    )
                    .with_description(
                        "Download this channel video attachment to inspect it with a video-capable tool.",
                    ),
                ));
            }
        }
    }

    // Video links are ready before any image fetch is awaited. Resolve the
    // bounded image batch concurrently, retaining attachment order in the output.
    for (attachment, image) in join_all(image_resolutions).await.into_iter().flatten() {
        result.content.push(Content::text(format!(
            "Channel image attachment {} ({})",
            attachment.entity_id, attachment.url,
        )));
        result
            .content
            .push(Content::image(image.data, image.mime_type));
    }
    result
}

// Channel results nest messages in timeline windows, thread parents, replies,
// and previews. Only attachment arrays in those successful tool results are
// enriched; message text is never interpreted as attachment references.
fn add_media_urls(
    value: &mut Value,
    base_url: &Url,
    seen: &mut HashSet<String>,
    media: &mut Vec<ChannelMedia>,
) {
    match value {
        Value::Array(values) => {
            for value in values {
                add_media_urls(value, base_url, seen, media);
            }
        }
        Value::Object(object) => {
            if let Some(Value::Array(attachments)) = object.get_mut("attachments") {
                for attachment in attachments {
                    let Some(attachment) = attachment.as_object_mut() else {
                        continue;
                    };
                    let kind = match attachment.get("entityType").and_then(Value::as_str) {
                        Some("static/image") => MediaKind::Image,
                        Some("static/video") => MediaKind::Video,
                        _ => continue,
                    };
                    let Some(entity_id) = attachment.get("entityId").and_then(Value::as_str) else {
                        continue;
                    };
                    // Static file IDs are path components, never URLs or paths.
                    if entity_id.is_empty()
                        || !entity_id
                            .bytes()
                            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
                    {
                        continue;
                    }
                    let mut url = base_url.clone();
                    let Ok(mut path) = url.path_segments_mut() else {
                        continue;
                    };
                    path.pop_if_empty().push("file").push(entity_id);
                    drop(path);
                    let url = url.to_string();
                    let entity_id = entity_id.to_owned();
                    attachment.insert("url".to_owned(), Value::String(url.clone()));
                    if seen.insert(url.clone()) {
                        media.push(ChannelMedia {
                            kind,
                            entity_id,
                            url,
                        });
                    }
                }
            }
            for (key, child) in object {
                if key != "attachments" {
                    add_media_urls(child, base_url, seen, media);
                }
            }
        }
        _ => {}
    }
}
