use super::*;

fn page(title: &str) -> GetUnfurlResponse {
    GetUnfurlResponse {
        url: "https://example.com/post".to_string(),
        title: title.to_string(),
        favicon_url: Some("https://example.com/favicon.ico".to_string()),
        ..Default::default()
    }
}

#[test]
fn a_page_with_only_its_address_and_a_guessed_favicon_gets_no_card() {
    assert_eq!(link_preview(page("https://example.com/post")), None);
    assert_eq!(link_preview(page("   ")), None);
}

#[test]
fn a_page_with_a_title_description_or_image_gets_a_card() {
    let titled = link_preview(page(" Offline first ")).unwrap();
    assert_eq!(titled.title, "Offline first");
    assert_eq!(titled.url, "https://example.com/post");

    let described = link_preview(GetUnfurlResponse {
        description: Some("What we learned".to_string()),
        ..page("https://example.com/post")
    })
    .unwrap();
    assert_eq!(described.title, "");
    assert_eq!(described.description.as_deref(), Some("What we learned"));

    let pictured = link_preview(GetUnfurlResponse {
        image_url: Some("https://example.com/cover.png".to_string()),
        description: Some("  ".to_string()),
        ..page("https://example.com/post")
    })
    .unwrap();
    assert_eq!(pictured.description, None);
    assert_eq!(
        pictured.image_url.as_deref(),
        Some("https://example.com/cover.png")
    );
}
