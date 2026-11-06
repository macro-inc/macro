use super::*;
use opensearch_query_builder::ToOpenSearchJson;

fn args(mode: AgentSessionSearchMode) -> AgentSessionSearchArgs {
    AgentSessionSearchArgs {
        terms: vec!["burger".into(), "fries".into()],
        session_ids: vec!["00000000-0000-0000-0000-000000000001".into()],
        mode,
    }
}

#[test]
fn access_allowlist_is_required_and_filters_parents() {
    let mut args = args(AgentSessionSearchMode::Content);
    let query = build_query(&args, "partial").unwrap().build().to_json();
    let filter = query["bool"]["filter"].as_array().unwrap();
    assert!(filter.contains(&serde_json::json!({"terms":{"agent_session_id":args.session_ids}})));
    assert!(filter.contains(&serde_json::json!({"term":{"_index":"agent_sessions"}})));
    assert!(
        filter.contains(&serde_json::json!({"term":{"agent_session_relation":"agent_session"}}))
    );
    args.session_ids.clear();
    assert!(build_query(&args, "partial").is_err());
}

#[test]
fn modes_keep_names_and_folded_content_separate_and_terms_in_one_session() {
    let content = build_query(&args(AgentSessionSearchMode::Content), "partial")
        .unwrap()
        .build()
        .to_json();
    let clauses = content["bool"]["should"].as_array().unwrap();
    assert_eq!(clauses.len(), 1);
    let terms = clauses[0]["bool"]["must"].as_array().unwrap();
    assert_eq!(terms.len(), 2);
    assert_eq!(terms[0]["has_child"]["type"], "message");
    assert!(terms[0]["has_child"]["query"]["match_phrase_prefix"].is_object());
    let name = build_query(&args(AgentSessionSearchMode::Name), "exact")
        .unwrap()
        .build()
        .to_json();
    assert!(!name.to_string().contains("has_child"));
    let both = build_query(&args(AgentSessionSearchMode::NameContent), "exact")
        .unwrap()
        .build()
        .to_json();
    assert_eq!(both["bool"]["should"].as_array().unwrap().len(), 2);
    assert!(!both.to_string().contains("match_phrase_prefix"));
}

#[test]
fn folded_hits_keep_turn_author_and_deduplicate_across_terms() {
    let message = serde_json::json!({
        "_id":"session:3:agent", "_score":2.0,
        "_source":{"message_turn":3,"author":"agent"},
        "highlight":{"content":["<macro_em>burger</macro_em> and fries"]}
    });
    let hit = Hit {
        source: AgentSessionIndex {
            agent_session_id: uuid::Uuid::from_u128(1),
            updated_at_millis: 1_789_130_978_862,
        },
        index: "arbitrary-physical-index".into(),
        matched_queries: vec!["agent_sessions".into()],
        score: Some(1.0),
        highlight: Some(std::collections::HashMap::from([(
            "name".into(),
            vec!["<macro_em>burger</macro_em>".into()],
        )])),
        inner_hits: Some(serde_json::json!({
            "agent_term_0":{"hits":{"hits":[message.clone()]}},
            "agent_term_1":{"hits":{"hits":[message]}}
        })),
    };
    let hits = expand(hit);
    assert_eq!(hits.len(), 2);
    assert!(hits[0].goto.is_none());
    let Some(SearchGotoContent::AgentSessions(goto)) = &hits[1].goto else {
        panic!("missing folded target")
    };
    assert_eq!(goto.message_turn, 3);
    assert_eq!(goto.author, super::super::model::AgentSessionAuthor::Agent);
    assert_eq!(hits[1].highlight.content.len(), 1);
}
