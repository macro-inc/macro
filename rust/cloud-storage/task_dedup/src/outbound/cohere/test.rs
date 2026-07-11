use std::borrow::Cow;

use embedding::{LabeledEmbedding, Match};

use super::*;

const DIMS: usize = 3;

fn search_result(metadata: &str, contents: &[&str]) -> SearchResults<String, DIMS> {
    SearchResults {
        metadata: metadata.to_string(),
        matches: contents
            .iter()
            .map(|content| Match {
                score: 0.5,
                embedding: LabeledEmbedding {
                    search_key: "title",
                    content: Cow::Owned(content.to_string()),
                    embedding: [0.0; DIMS],
                },
            })
            .collect(),
    }
}

#[test]
fn document_text_joins_matched_field_contents() {
    let result = search_result("doc-1", &["fix the login bug", "users cannot sign in"]);
    assert_eq!(
        document_text(&result),
        "fix the login bug\nusers cannot sign in"
    );
}

#[test]
fn document_text_of_empty_matches_is_empty() {
    let result = search_result("doc-1", &[]);
    assert_eq!(document_text(&result), "");
}

#[test]
fn order_by_relevance_reorders_candidates_by_result_index() {
    let results = vec![
        CohereRerankResult {
            index: 2,
            relevance_score: 0.9,
        },
        CohereRerankResult {
            index: 0,
            relevance_score: 0.4,
        },
        CohereRerankResult {
            index: 1,
            relevance_score: 0.1,
        },
    ];
    let reranked = order_by_relevance(results, vec!["a", "b", "c"]).unwrap();
    let ordered: Vec<_> = reranked
        .iter()
        .map(|reranked| (reranked.item, reranked.score))
        .collect();
    assert_eq!(ordered, vec![("c", 0.9), ("a", 0.4), ("b", 0.1)]);
}

#[test]
fn order_by_relevance_rejects_out_of_range_index() {
    let results = vec![CohereRerankResult {
        index: 3,
        relevance_score: 0.9,
    }];
    let error = order_by_relevance(results, vec!["a"]).err().unwrap();
    assert!(error.to_string().contains("out-of-range index 3"));
}

#[test]
fn order_by_relevance_rejects_duplicate_index() {
    let results = vec![
        CohereRerankResult {
            index: 0,
            relevance_score: 0.9,
        },
        CohereRerankResult {
            index: 0,
            relevance_score: 0.4,
        },
    ];
    let error = order_by_relevance(results, vec!["a", "b"]).err().unwrap();
    assert!(error.to_string().contains("duplicate index 0"));
}
