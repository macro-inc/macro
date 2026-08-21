use super::*;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::json;
use std::collections::HashMap;

const TINY_PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
    0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
    0x42, 0x60, 0x82,
];

fn user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("User@macro.com").unwrap()
}

fn read_content_markdown(nodes: serde_json::Value) -> serde_json::Value {
    json!({
        "content": { "markdown": nodes },
        "comments": []
    })
}

#[derive(Clone, Default)]
struct FakeResolver {
    static_images: HashMap<String, ResolvedImage>,
    dss_images: HashMap<String, ResolvedImage>,
}

#[async_trait]
impl MarkdownImageResolver for FakeResolver {
    async fn resolve_static(&self, url: &str) -> Option<ResolvedImage> {
        self.static_images.get(url).cloned()
    }

    async fn resolve_dss(&self, _user_id: &MacroUserIdStr<'_>, id: &str) -> Option<ResolvedImage> {
        self.dss_images.get(id).cloned()
    }
}

#[test]
fn markdown_image_refs_collect_static_and_dss_nodes() {
    let value = read_content_markdown(json!([
        {
            "type": "generic",
            "nodeId": "n1",
            "content": "Long tag names are hidden in the dropdown.",
            "tag": "paragraph"
        },
        { "type": "staticImage", "url": "https://static.example/tag-dropdown.png" },
        { "type": "dssImage", "id": "bb7ee066-7f29-4282-ae9e-beca188d033e" }
    ]));

    assert_eq!(
        markdown_image_refs(&value),
        vec![
            ImageRef::Static("https://static.example/tag-dropdown.png".into()),
            ImageRef::Dss("bb7ee066-7f29-4282-ae9e-beca188d033e".into()),
        ]
    );
}

#[test]
fn markdown_image_refs_ignore_plain_text_and_unrelated_json() {
    assert!(
        markdown_image_refs(&json!({ "content": { "text": "hello" }, "comments": [] })).is_empty()
    );
    assert!(markdown_image_refs(&json!({ "items": [] })).is_empty());
}

#[tokio::test]
async fn tool_result_keeps_structured_json_and_appends_image_blocks() {
    let resolver = FakeResolver {
        static_images: HashMap::from([(
            "https://static.example/tag-dropdown.png".into(),
            ResolvedImage {
                data: "aaa".into(),
                mime_type: "image/webp".into(),
            },
        )]),
        dss_images: HashMap::from([(
            "img-1".into(),
            ResolvedImage {
                data: "bbb".into(),
                mime_type: "image/webp".into(),
            },
        )]),
    };
    let value = read_content_markdown(json!([
        {
            "type": "generic",
            "nodeId": "n1",
            "content": "Long tag names are hidden in the dropdown.",
            "tag": "paragraph"
        },
        { "type": "staticImage", "url": "https://static.example/tag-dropdown.png" },
        { "type": "dssImage", "id": "img-1" }
    ]));

    let result = tool_result_with_images(&resolver, &user_id(), value.clone()).await;

    assert_eq!(result.structured_content.as_ref(), Some(&value));
    assert_eq!(result.is_error, Some(false));
    assert_eq!(result.content.len(), 3);
    let expected_text = value.to_string();
    assert_eq!(
        result.content[0].as_text().map(|text| text.text.as_str()),
        Some(expected_text.as_str())
    );

    let first_image = result.content[1]
        .as_image()
        .expect("staticImage must become an MCP image block");
    assert_eq!(first_image.data, "aaa");
    assert_eq!(first_image.mime_type, "image/webp");

    let second_image = result.content[2]
        .as_image()
        .expect("dssImage must become an MCP image block");
    assert_eq!(second_image.data, "bbb");
    assert_eq!(second_image.mime_type, "image/webp");
}

#[tokio::test]
async fn tool_result_without_images_stays_structured_text() {
    let value = read_content_markdown(json!([
        { "type": "generic", "nodeId": "n1", "content": "no pictures", "tag": "paragraph" }
    ]));

    let result = tool_result_with_images(&FakeResolver::default(), &user_id(), value.clone()).await;

    assert_eq!(result.content.len(), 1);
    assert!(result.content[0].as_text().is_some());
    assert!(result.content[0].as_image().is_none());
}

#[tokio::test]
async fn unresolved_images_are_omitted_from_content_blocks() {
    let value = read_content_markdown(json!([
        { "type": "staticImage", "url": "https://missing.example/gone.png" }
    ]));

    let result = tool_result_with_images(&FakeResolver::default(), &user_id(), value).await;

    assert_eq!(result.content.len(), 1);
    assert!(result.content[0].as_image().is_none());
}

#[tokio::test]
async fn fetch_and_encode_returns_webp_bytes() {
    let app = axum::Router::new().route(
        "/",
        axum::routing::get(|| async {
            ([(axum::http::header::CONTENT_TYPE, "image/png")], TINY_PNG)
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let image = fetch_and_encode(&format!("http://{addr}/"))
        .await
        .expect("png should encode as a webp image block");
    assert_eq!(image.mime_type, "image/webp");
    assert!(!image.data.is_empty());
}
