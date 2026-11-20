//! Synthetic Notion-Version 2026-03-11 enhanced-markdown v1 cases from
//! https://developers.notion.com/guides/data-apis/enhanced-markdown#page-and-database-references

use super::occurrences;
use crate::domain::model::NotionId;

#[test]
fn the_shared_database_fixture_keeps_inline_and_self_closing_ordinals() {
    let parsed = occurrences(include_str!("../../../../fixtures/database_occurrences.md"));
    assert_eq!(parsed.len(), 7);
    let linked: Vec<_> = parsed
        .iter()
        .filter(|item| {
            item.key
                .as_ref()
                .is_some_and(|key| key.container_id.as_str() == "d9824bdc84454327be8b5b47500af6ce")
        })
        .collect();
    assert_eq!(
        linked
            .iter()
            .map(|item| item.title.as_str())
            .collect::<Vec<_>>(),
        vec![
            "External tasks",
            "External tasks again",
            "Mid-line tasks",
            "Self-closing tasks",
            "Final tasks"
        ]
    );
    assert_eq!(
        linked
            .iter()
            .map(|item| item.key.as_ref().unwrap().ordinal)
            .collect::<Vec<_>>(),
        vec![0, 1, 2, 3, 4]
    );
}

#[test]
fn a_fragment_cannot_supply_a_selected_view() {
    let parsed = occurrences(
        "<database url=\"https://www.notion.so/d9824bdc84454327be8b5b47500af6ce#section?v=ee5f0f84409a440f983aa5315961c6e4\" inline=\"true\">Tasks</database>",
    );
    assert_eq!(parsed.len(), 1);
    assert_eq!(
        parsed[0].key.as_ref().unwrap().container_id,
        NotionId::parse("d9824bdc84454327be8b5b47500af6ce").unwrap()
    );
    assert_eq!(parsed[0].view_id, None);
}

#[test]
fn a_fence_marker_inside_code_does_not_end_the_code_block() {
    let parsed = occurrences(
        "```xml\ntext with ``` inside\n<database url=\"https://www.notion.so/d9824bdc84454327be8b5b47500af6ce\">Code sample</database>\n```\n<database url=\"https://www.notion.so/d9824bdc84454327be8b5b47500af6ce\">Real placement</database>",
    );
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].title, "Real placement");
    assert_eq!(parsed[0].key.as_ref().unwrap().ordinal, 0);
}

#[test]
fn a_blank_url_still_has_a_named_notion_fallback() {
    let parsed = occurrences("<database url=\"  \" inline=\"true\"></database>");
    let page = NotionId::parse("598337872cf94fdf8782e53db20768a5").unwrap();
    assert_eq!(parsed[0].title, "Notion database");
    assert_eq!(parsed[0].fallback_url(&page), page.url());
}
