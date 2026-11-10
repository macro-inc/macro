use super::*;

#[test]
fn test_extract_opengraph() {
    let mut tags: HashMap<String, String> = HashMap::new();
    tags.insert("property:og:title".to_string(), "hello".to_string());
    tags.insert(
        "property:og:description".to_string(),
        "this is a description".to_string(),
    );
    tags.insert("property:og:image".to_string(), "foo.jpg".to_string());

    let link = GetUnfurlResponse::new("localhost", &tags);

    assert_eq!(link.url, "localhost");
    assert_eq!(link.title, "hello");
    assert_eq!(link.description.as_deref(), Some("this is a description"));
    assert_eq!(link.image_url.as_deref(), Some("foo.jpg"));
}

#[test]
fn test_og_title_before_sitename() {
    let mut tags = HashMap::new();
    tags.insert(
        "property:og:site_name".to_string(),
        "website title".to_string(),
    );
    tags.insert("property:og:title".to_string(), "hello".to_string());

    let response = GetUnfurlResponse::new("localhost", &tags);
    assert_eq!(response.title, "hello");
}

#[test]
fn test_fallback_to_title_tag() {
    let mut tags = HashMap::new();
    tags.insert("title".to_string(), "Website Title".to_string());

    let response = GetUnfurlResponse::new("localhost", &tags);
    assert_eq!(response.title, "Website Title");
}

#[test]
fn test_custom_url_title_parsing_notion() {
    let empty_tags = HashMap::new();

    let notion_url = "https://www.notion.so/macrocom/Enterprise-Product-Bottlenecks-5acb869109a747c1a1a92bbf1891ff2d";
    assert_eq!(
        GetUnfurlResponse::get_title(notion_url, &empty_tags),
        "Enterprise Product Bottlenecks"
    );

    assert_eq!(
        GetUnfurlResponse::get_title("https://www.notion.so", &empty_tags),
        "Notion"
    );
}

#[test]
fn test_custom_url_falls_back_to_metadata() {
    let mut tags = HashMap::new();
    tags.insert(
        "property:og:title".to_string(),
        "Regular Website Title".to_string(),
    );

    let title = GetUnfurlResponse::get_title("https://example.com/some/page", &tags);
    assert_eq!(title, "Regular Website Title");
}

#[test]
fn description_falls_back_through_twitter_meta_and_first_paragraph() {
    let mut tags = HashMap::new();
    tags.insert("paragraph".to_string(), "The first paragraph.".to_string());
    assert_eq!(
        GetUnfurlResponse::new("https://example.com", &tags)
            .description
            .as_deref(),
        Some("The first paragraph.")
    );

    tags.insert("name:description".to_string(), "Meta.".to_string());
    assert_eq!(
        GetUnfurlResponse::new("https://example.com", &tags)
            .description
            .as_deref(),
        Some("Meta.")
    );

    tags.insert("name:twitter:description".to_string(), "Card.".to_string());
    assert_eq!(
        GetUnfurlResponse::new("https://example.com", &tags)
            .description
            .as_deref(),
        Some("Card.")
    );

    tags.insert("property:og:description".to_string(), "Graph.".to_string());
    assert_eq!(
        GetUnfurlResponse::new("https://example.com", &tags)
            .description
            .as_deref(),
        Some("Graph.")
    );
}

#[test]
fn description_skips_blank_sources_and_reads_as_one_line() {
    let mut tags = HashMap::new();
    tags.insert("property:og:description".to_string(), "  \n ".to_string());
    tags.insert(
        "name:description".to_string(),
        "Two\n   lines of  text".to_string(),
    );

    assert_eq!(
        GetUnfurlResponse::new("https://example.com", &tags)
            .description
            .as_deref(),
        Some("Two lines of text")
    );
}

#[test]
fn description_is_cut_to_what_a_preview_can_show() {
    let mut tags = HashMap::new();
    tags.insert("name:description".to_string(), "é".repeat(600));

    let description = GetUnfurlResponse::new("https://example.com", &tags)
        .description
        .unwrap();

    assert_eq!(description, format!("{}…", "é".repeat(500)));
}
