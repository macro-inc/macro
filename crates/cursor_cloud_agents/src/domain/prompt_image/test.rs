use super::*;
use agent_client_protocol::schema::v1::{ResourceLink, TextContent};

fn text(value: &str) -> ContentBlock {
    ContentBlock::Text(TextContent::new(value))
}

#[test]
fn a_pasted_image_link_is_taken_whole() {
    let url = "https://cdn.example/images?q=thumbnail&size=10";
    let blocks = vec![text(&format!("look at {url} please"))];
    assert_eq!(linked_image_urls(&blocks), vec![url.to_owned()]);
}

#[test]
fn surrounding_punctuation_is_not_part_of_the_link() {
    let blocks = vec![text("see (https://cdn.example/a.png).")];
    assert_eq!(
        linked_image_urls(&blocks),
        vec!["https://cdn.example/a.png".to_owned()]
    );
}

#[test]
fn https_is_not_read_as_a_later_http_link() {
    let blocks = vec![text(
        "https://cdn.example/a.png and then http://cdn.example/b.jpg",
    )];
    assert_eq!(
        linked_image_urls(&blocks),
        vec![
            "https://cdn.example/a.png".to_owned(),
            "http://cdn.example/b.jpg".to_owned(),
        ]
    );
}

#[test]
fn a_link_already_carried_as_an_image_is_not_fetched_again() {
    let image = CursorPromptImage {
        data: "aW1n".to_owned(),
        mime_type: "image/png".to_owned(),
        source_url: Some("https://cdn.example/a.png".to_owned()),
    };
    let blocks = vec![text("https://cdn.example/a.png"), image.to_content_block()];
    assert!(linked_image_urls(&blocks).is_empty());
}

#[test]
fn an_svg_resource_link_is_not_fetched() {
    let blocks = vec![ContentBlock::ResourceLink(
        ResourceLink::new("icon.svg", "https://cdn.example/icon.svg").mime_type("image/svg+xml"),
    )];
    assert!(linked_image_urls(&blocks).is_empty());
}

#[test]
fn a_png_resource_link_is_fetched() {
    let blocks = vec![ContentBlock::ResourceLink(
        ResourceLink::new("shot.png", "https://cdn.example/shot.png").mime_type("image/png"),
    )];
    assert_eq!(
        linked_image_urls(&blocks),
        vec!["https://cdn.example/shot.png".to_owned()]
    );
}

#[test]
fn magic_bytes_name_the_image_when_the_type_does_not() {
    assert_eq!(
        detect_mime(
            Some("application/octet-stream"),
            &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]
        ),
        Some("image/png")
    );
    assert_eq!(
        detect_mime(Some("image/jpeg"), &[0xFF, 0xD8, 0xFF, 0x00]),
        Some("image/jpeg")
    );
    assert_eq!(detect_mime(Some("text/html"), b"<html>"), None);
    assert_eq!(detect_mime(Some("image/jpg"), b""), None);
    assert_eq!(detect_mime(Some("image/png"), b"<svg>"), None);
    assert_eq!(detect_mime(Some("image/svg+xml"), b"<svg>"), None);
}

#[test]
fn a_fetched_image_is_an_acp_image_frame_named_by_its_url() {
    let image = CursorPromptImage {
        data: "aW1n".to_owned(),
        mime_type: "image/png".to_owned(),
        source_url: Some("https://cdn.example/a.png".to_owned()),
    };
    let ContentBlock::Image(frame) = image.to_content_block() else {
        panic!("an image frame");
    };
    assert_eq!(frame.data, "aW1n");
    assert_eq!(frame.mime_type, "image/png");
    assert_eq!(frame.uri.as_deref(), Some("https://cdn.example/a.png"));
}

#[test]
fn plain_http_word_does_not_hide_a_later_url() {
    assert_eq!(
        linked_image_urls(&[text("use http with https://cdn.example/pic")]),
        vec!["https://cdn.example/pic"]
    );
}

#[test]
fn duplicate_links_and_fetch_count_are_bounded() {
    let blocks = vec![text(
        "https://cdn.example/0 https://cdn.example/0 https://cdn.example/1 https://cdn.example/2 https://cdn.example/3 https://cdn.example/4 https://cdn.example/5 https://cdn.example/6 https://cdn.example/7 https://cdn.example/8",
    )];
    let urls = linked_image_urls(&blocks);
    assert_eq!(urls.len(), MAX_LINK_FETCHES);
    assert_eq!(urls[0], "https://cdn.example/0");
    assert_eq!(urls[7], "https://cdn.example/7");
}
