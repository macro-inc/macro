use super::*;
use macro_db_client::projects::get_project_history::ProjectHistoryInfo;
use models_opensearch::SearchEntityType;
use opensearch_client::search::model::{Highlight, SearchHit};

#[test]
fn trashed_project_hits_are_dropped() {
    let now = chrono::Utc::now();
    let hits = vec![
        SearchHit {
            entity_id: "11111111-1111-1111-1111-111111111111".parse().unwrap(),
            entity_type: SearchEntityType::Projects,
            goto: None,
            score: None,
            highlight: Highlight {
                name: Some("<macro_em>plans</macro_em>".to_string()),
                ..Default::default()
            },
            updated_at: None,
        },
        SearchHit {
            entity_id: "22222222-2222-2222-2222-222222222222".parse().unwrap(),
            entity_type: SearchEntityType::Projects,
            goto: None,
            score: None,
            highlight: Highlight {
                name: Some("<macro_em>plans</macro_em> live".to_string()),
                ..Default::default()
            },
            updated_at: None,
        },
    ];

    let mut project_histories = HashMap::new();
    project_histories.insert(
        "11111111-1111-1111-1111-111111111111".to_string(),
        ProjectHistoryInfo {
            item_id: "11111111-1111-1111-1111-111111111111".to_string(),
            created_at: now,
            updated_at: now,
            viewed_at: None,
            parent_project_id: None,
            deleted_at: Some(now),
            user_id: "user_1".to_string(),
            name: "plans".to_string(),
        },
    );
    project_histories.insert(
        "22222222-2222-2222-2222-222222222222".to_string(),
        ProjectHistoryInfo {
            item_id: "22222222-2222-2222-2222-222222222222".to_string(),
            created_at: now,
            updated_at: now,
            viewed_at: None,
            parent_project_id: None,
            deleted_at: None,
            user_id: "user_1".to_string(),
            name: "plans live".to_string(),
        },
    );

    let result = construct_search_result(hits, project_histories, HashMap::new()).unwrap();

    let ids: Vec<String> = result.iter().map(|r| r.extra.id.to_string()).collect();
    assert_eq!(
        ids,
        vec!["22222222-2222-2222-2222-222222222222".to_string()]
    );
}
