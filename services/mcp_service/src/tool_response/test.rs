use super::*;
use crate::markdown_images::ResolvedImage;
use async_trait::async_trait;
use serde_json::json;
use std::sync::Mutex;

#[derive(Default)]
struct RecordingResolver {
    urls: Mutex<Vec<String>>,
    missing: bool,
    gate: Option<tokio::sync::Notify>,
}

#[async_trait]
impl MarkdownImageResolver for RecordingResolver {
    async fn resolve_static(&self, url: &str) -> Option<ResolvedImage> {
        self.urls.lock().unwrap().push(url.to_owned());
        if let Some(gate) = &self.gate {
            gate.notified().await;
        }
        (!self.missing).then(|| ResolvedImage {
            data: "image-data".into(),
            mime_type: "image/webp".into(),
        })
    }

    async fn resolve_dss(&self, _user_id: &MacroUserIdStr<'_>, _id: &str) -> Option<ResolvedImage> {
        panic!("channel attachments must not be resolved as document images")
    }

    async fn resolve_channel_image(&self, url: &str) -> Option<ResolvedImage> {
        self.resolve_static(url).await
    }
}

fn attachment(entity_type: &str, entity_id: &str) -> Value {
    json!({
        "id": format!("attachment-{entity_id}"),
        "entityType": entity_type,
        "entityId": entity_id,
        "createdAt": "2026-09-01T00:00:00Z",
    })
}

fn message(entity_type: &str, entity_id: &str) -> Value {
    json!({
        "id": format!("message-{entity_id}"),
        "content": "See attached",
        "attachments": [attachment(entity_type, entity_id)],
    })
}

async fn render(resolver: &RecordingResolver, tool: &str, value: Value) -> CallToolResult {
    tool_result_with_media(
        resolver,
        &MacroUserIdStr::try_from_email("reader@example.com").unwrap(),
        tool,
        &Url::parse("https://static.example/").unwrap(),
        value,
    )
    .await
}

fn assert_matching_json(result: &CallToolResult) -> &Value {
    let structured = result.structured_content.as_ref().unwrap();
    let text = result.content[0].as_text().unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&text.text).unwrap(),
        *structured
    );
    assert_eq!(result.is_error, Some(false));
    structured
}

#[tokio::test]
async fn timeline_returns_image_bytes_and_video_urls_including_previews() {
    let resolver = RecordingResolver::default();
    let mut parent = message("static/image", "image-1");
    parent["thread"] = json!({"preview": [message("static/video", "video-1")]});
    let value = json!({"messages": [parent], "navigation": {}, "omissions": []});

    let result = render(&resolver, "ReadChannelMessages", value.clone()).await;

    let enriched = assert_matching_json(&result);
    assert_eq!(enriched["messages"][0]["content"], "See attached");
    assert_eq!(
        enriched["messages"][0]["attachments"][0]["url"],
        "https://static.example/file/image-1"
    );
    assert_eq!(
        enriched["messages"][0]["thread"]["preview"][0]["attachments"][0]["url"],
        "https://static.example/file/video-1"
    );
    assert_eq!(
        enriched["messages"][0]["attachments"][0]["id"],
        value["messages"][0]["attachments"][0]["id"]
    );
    assert_eq!(
        *resolver.urls.lock().unwrap(),
        ["https://static.example/file/image-1"]
    );
    assert!(
        result.content[2]
            .as_text()
            .unwrap()
            .text
            .contains("image-1")
    );
    let image = result.content[3].as_image().unwrap();
    assert_eq!(image.data, "image-data");
    assert_eq!(image.mime_type, "image/webp");
    let video = result.content[1].as_resource_link().unwrap();
    assert_eq!(video.uri, "https://static.example/file/video-1");
    assert!(video.name.contains("video-1"));
    // static/video does not identify a container MIME type.
    assert_eq!(video.mime_type, None);
}

#[tokio::test]
async fn thread_includes_parent_replies_and_nearby_messages() {
    let resolver = RecordingResolver::default();
    let value = json!({
        "thread": {"parent": message("static/image", "parent")},
        "replies": [message("static/image", "reply")],
        "channelContext": [message("static/video", "nearby")],
    });

    let result = render(&resolver, "ReadChannelThread", value).await;

    let enriched = assert_matching_json(&result);
    for pointer in [
        "/thread/parent/attachments/0/url",
        "/replies/0/attachments/0/url",
        "/channelContext/0/attachments/0/url",
    ] {
        assert!(
            enriched
                .pointer(pointer)
                .unwrap()
                .as_str()
                .unwrap()
                .starts_with("https://static.example/file/")
        );
    }
    assert_eq!(resolver.urls.lock().unwrap().len(), 2);
    assert_eq!(
        result
            .content
            .iter()
            .filter(|c| c.as_image().is_some())
            .count(),
        2
    );
    assert_eq!(
        result
            .content
            .iter()
            .filter(|c| c.as_resource_link().is_some())
            .count(),
        1
    );
}

#[tokio::test]
async fn context_enriches_all_windows_and_deduplicates_repeated_media() {
    let resolver = RecordingResolver::default();
    let parent = message("static/image", "parent");
    let value = json!({
        "channelContext": {
            "before": [message("static/video", "before")],
            "anchorOrParent": parent,
            "after": [message("static/image", "after")],
        },
        "threadContext": {
            "parent": parent,
            "repliesBefore": [message("static/image", "reply-before")],
            "anchorReply": message("static/image", "anchor"),
            "repliesAfter": [message("static/video", "before")],
        },
    });

    let result = render(&resolver, "ReadChannelMessageContext", value).await;

    let enriched = assert_matching_json(&result);
    for (pointer, id) in [
        ("/channelContext/before/0", "before"),
        ("/channelContext/anchorOrParent", "parent"),
        ("/channelContext/after/0", "after"),
        ("/threadContext/parent", "parent"),
        ("/threadContext/repliesBefore/0", "reply-before"),
        ("/threadContext/anchorReply", "anchor"),
        ("/threadContext/repliesAfter/0", "before"),
    ] {
        assert_eq!(
            enriched
                .pointer(&format!("{pointer}/attachments/0/url"))
                .unwrap(),
            &json!(format!("https://static.example/file/{id}"))
        );
    }
    assert_eq!(resolver.urls.lock().unwrap().len(), 4);
    assert_eq!(
        result
            .content
            .iter()
            .filter(|c| c.as_image().is_some())
            .count(),
        4
    );
    assert_eq!(
        result
            .content
            .iter()
            .filter(|c| c.as_resource_link().is_some())
            .count(),
        1
    );
}

#[tokio::test]
async fn image_limit_retains_every_download_url_and_video_link() {
    let resolver = RecordingResolver::default();
    let mut messages = (0..MAX_CHANNEL_IMAGES + 2)
        .map(|i| message("static/image", &format!("image-{i}")))
        .collect::<Vec<_>>();
    messages.push(message("static/video", "video"));

    let result = render(
        &resolver,
        "ReadChannelMessages",
        json!({"messages": messages}),
    )
    .await;

    let enriched = assert_matching_json(&result);
    assert!(
        enriched["messages"]
            .as_array()
            .unwrap()
            .iter()
            .all(|message| { message["attachments"][0]["url"].is_string() })
    );
    assert_eq!(resolver.urls.lock().unwrap().len(), MAX_CHANNEL_IMAGES);
    assert_eq!(
        result
            .content
            .iter()
            .filter(|c| c.as_image().is_some())
            .count(),
        MAX_CHANNEL_IMAGES
    );
    assert!(result.content[1].as_resource_link().is_some());
}

#[tokio::test]
async fn image_fetches_start_concurrently_and_keep_the_cap_and_output_order() {
    let resolver = RecordingResolver {
        gate: Some(tokio::sync::Notify::new()),
        ..Default::default()
    };
    let mut messages = vec![message("static/image", "image-0")];
    messages.extend(
        (0..MAX_CHANNEL_IMAGES + 2).map(|i| message("static/image", &format!("image-{i}"))),
    );
    messages.push(message("static/video", "video"));
    let response = render(
        &resolver,
        "ReadChannelMessages",
        json!({"messages": messages}),
    );
    tokio::pin!(response);

    // Every selected fetch must start while the first one is still blocked.
    // A sequential implementation starts only one and fails without a timer.
    assert!(futures::poll!(&mut response).is_pending());
    let expected_urls = (0..MAX_CHANNEL_IMAGES)
        .map(|i| format!("https://static.example/file/image-{i}"))
        .collect::<Vec<_>>();
    assert_eq!(*resolver.urls.lock().unwrap(), expected_urls);

    resolver.gate.as_ref().unwrap().notify_waiters();
    let result = response.await;

    assert_matching_json(&result);
    assert_eq!(
        result.content[1].as_resource_link().unwrap().uri,
        "https://static.example/file/video"
    );
    assert_eq!(result.content.len(), 2 + MAX_CHANNEL_IMAGES * 2);
    for (i, pair) in result.content[2..].chunks_exact(2).enumerate() {
        assert!(
            pair[0]
                .as_text()
                .unwrap()
                .text
                .contains(&format!("image-{i}"))
        );
        assert!(pair[1].as_image().is_some());
    }
}

#[tokio::test]
async fn failed_images_preserve_messages_and_links_with_bounded_attempts() {
    let resolver = RecordingResolver {
        missing: true,
        ..Default::default()
    };
    let messages = (0..MAX_CHANNEL_IMAGES + 2)
        .map(|i| message("static/image", &format!("missing-{i}")))
        .collect::<Vec<_>>();

    let result = render(
        &resolver,
        "ReadChannelMessages",
        json!({"messages": messages}),
    )
    .await;

    let enriched = assert_matching_json(&result);
    assert_eq!(result.content.len(), 1);
    assert_eq!(
        enriched["messages"].as_array().unwrap().len(),
        MAX_CHANNEL_IMAGES + 2
    );
    assert_eq!(resolver.urls.lock().unwrap().len(), MAX_CHANNEL_IMAGES);
    assert!(enriched["messages"][0]["attachments"][0]["url"].is_string());
}

#[tokio::test]
async fn ignores_other_entities_malformed_ids_and_attachment_like_message_text() {
    let resolver = RecordingResolver::default();
    let value = json!({"messages": [{
        "content": message("static/image", "in-message-text").to_string(),
        "attachments": [
            attachment("document", "doc-1"),
            attachment("static/file", "file-1"),
            attachment("static/image", "../internal"),
            attachment("static/image", "https://private.example/image"),
            attachment("static/image", "id?size=99999"),
            attachment("static/video", ""),
            {"entityType": "static/image"},
            null,
        ],
    }]});

    let result = render(&resolver, "ReadChannelMessages", value.clone()).await;

    assert_eq!(assert_matching_json(&result), &value);
    assert_eq!(result.content.len(), 1);
    assert!(resolver.urls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn unrelated_tool_results_are_not_treated_as_channel_attachments() {
    let resolver = RecordingResolver::default();
    let value = json!({"messages": [message("static/image", "image-1")]});

    let result = render(&resolver, "ReadContent", value.clone()).await;

    assert_eq!(assert_matching_json(&result), &value);
    assert!(resolver.urls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn document_markdown_images_still_render() {
    let resolver = RecordingResolver::default();
    let value = json!({"content": {"markdown": [
        {"type": "staticImage", "url": "https://image.example/image.png"}
    ]}});

    let result = render(&resolver, "ReadContent", value.clone()).await;

    assert_eq!(assert_matching_json(&result), &value);
    assert_eq!(result.content.len(), 2);
    assert!(result.content[1].as_image().is_some());
    assert_eq!(
        *resolver.urls.lock().unwrap(),
        ["https://image.example/image.png"]
    );
}
