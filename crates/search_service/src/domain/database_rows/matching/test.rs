use super::*;

fn query(terms: &[&str], match_type: RowMatchType) -> RowQuery {
    let terms: Vec<String> = terms.iter().map(|term| term.to_string()).collect();
    RowQuery::new(&terms, match_type).expect("query has words")
}

#[test]
fn partial_matches_a_word_prefix_case_insensitively() {
    let query = query(&["ACME"], RowMatchType::Partial);

    assert!(query.matches(["Acmeville renewal"]));
    assert!(!query.matches(["the acm corporation"]));
}

#[test]
fn exact_needs_the_whole_word() {
    let query = query(&["acme"], RowMatchType::Exact);

    assert!(query.matches(["Acme renewal"]));
    assert!(!query.matches(["Acmeville renewal"]));
}

#[test]
fn every_term_must_match_but_each_may_match_a_different_cell() {
    let query = query(&["acme", "renewal"], RowMatchType::Partial);

    assert!(query.matches(["Acme", "Q3 renewal"]));
    assert!(!query.matches(["Acme", "Q3 kickoff"]));
}

#[test]
fn a_phrase_keeps_its_words_adjacent_and_in_one_cell() {
    let query = query(&["acme renewal"], RowMatchType::Partial);

    assert!(query.matches(["Acme renewal call"]));
    assert!(!query.matches(["renewal for Acme"]));
    assert!(!query.matches(["Acme", "renewal"]));
}

#[test]
fn a_term_without_words_is_dropped_and_none_left_matches_nothing() {
    let terms = vec!["-".to_string(), "@".to_string()];

    assert!(RowQuery::new(&terms, RowMatchType::Partial).is_none());
}

#[test]
fn text_without_the_term_has_no_snippet() {
    let query = query(&["acme"], RowMatchType::Partial);

    assert_eq!(query.snippet("Globex renewal"), None);
}

#[test]
fn snippet_highlights_every_matched_word() {
    let query = query(&["acme", "renewal"], RowMatchType::Partial);

    assert_eq!(
        query.snippet("Call Acme about the renewals").as_deref(),
        Some("Call <macro_em>Acme</macro_em> about the <macro_em>renewals</macro_em>")
    );
}

#[test]
fn snippet_highlights_a_phrase_as_one_span() {
    let query = query(&["acme renewal"], RowMatchType::Partial);

    assert_eq!(
        query.snippet("Plan: Acme renewal.").as_deref(),
        Some("Plan: <macro_em>Acme renewal</macro_em>.")
    );
}

#[test]
fn a_long_cell_is_cut_around_its_first_match() {
    let query = query(&["needle"], RowMatchType::Partial);
    let text = format!("{} needle {}", "a".repeat(300), "b".repeat(300));

    let snippet = query.snippet(&text).expect("matches");

    assert!(snippet.starts_with('…'));
    assert!(snippet.ends_with('…'));
    assert!(snippet.contains("<macro_em>needle</macro_em>"));
    let shown = snippet.replace("<macro_em>", "").replace("</macro_em>", "");
    assert_eq!(shown.chars().count(), SNIPPET_CHARS + 2);
}

#[test]
fn snippet_counts_characters_not_bytes() {
    let query = query(&["café"], RowMatchType::Exact);

    assert_eq!(
        query.snippet("Le Café ☕ ouvre").as_deref(),
        Some("Le <macro_em>Café</macro_em> ☕ ouvre")
    );
}
