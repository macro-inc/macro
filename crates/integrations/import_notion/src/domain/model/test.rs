use super::NotionId;

#[test]
fn a_dashed_id_is_normalized_to_lowercase_without_dashes() {
    let id = NotionId::parse("59833787-2CF9-4FDF-8782-E53DB20768A5").unwrap();

    assert_eq!(id.as_str(), "598337872cf94fdf8782e53db20768a5");
    assert_eq!(
        id.url(),
        "https://www.notion.so/598337872cf94fdf8782e53db20768a5"
    );
}

#[test]
fn a_dashless_id_parses_as_is() {
    assert_eq!(
        NotionId::parse("598337872cf94fdf8782e53db20768a5")
            .unwrap()
            .as_str(),
        "598337872cf94fdf8782e53db20768a5"
    );
}

#[test]
fn a_page_url_yields_the_id_after_its_slug() {
    assert_eq!(
        NotionId::parse(
            "https://www.notion.so/acme/Q3-plan-3fb607323e2e80629886fc0c028d50a7?pvs=4#heading"
        )
        .unwrap()
        .as_str(),
        "3fb607323e2e80629886fc0c028d50a7"
    );
}

#[test]
fn a_url_with_a_trailing_slash_still_parses() {
    assert_eq!(
        NotionId::parse("https://www.notion.so/3fb607323e2e80629886fc0c028d50a7/")
            .unwrap()
            .as_str(),
        "3fb607323e2e80629886fc0c028d50a7"
    );
}

#[test]
fn text_without_32_hex_digits_is_not_an_id() {
    assert_eq!(NotionId::parse("https://www.notion.so/Q3-plan"), None);
    assert_eq!(NotionId::parse("598337872cf94fdf8782e53db2076"), None);
    assert_eq!(NotionId::parse("zz8337872cf94fdf8782e53db20768a5"), None);
    assert_eq!(NotionId::parse(""), None);
}

#[test]
fn ids_deserialize_from_either_form() {
    let id: NotionId = serde_json::from_str("\"59833787-2cf9-4fdf-8782-e53db20768a5\"").unwrap();

    assert_eq!(id.as_str(), "598337872cf94fdf8782e53db20768a5");
    assert!(serde_json::from_str::<NotionId>("\"not-an-id\"").is_err());
}

#[test]
fn a_database_view_link_yields_the_database_not_the_view_in_its_query() {
    assert_eq!(
        NotionId::parse(
            "https://www.notion.so/acme/1a44be1209534631a1d67d4c2b1b4a2f?v=d9824bdc84454327be8b5b47500af6ce&p=598337872cf94fdf8782e53db20768a5"
        )
        .unwrap()
        .as_str(),
        "1a44be1209534631a1d67d4c2b1b4a2f"
    );
}
