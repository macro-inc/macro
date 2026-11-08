use std::collections::HashSet;

use opensearch_client::search::unified::{UnifiedEmailSearchArgs, UnifiedSearchArgs};
use opensearch_types::OpenSearchEntityType;
use search_cursor_types::SearchCursorOption;

fn main() {
    let args = UnifiedSearchArgs {
        user_id: "macro|gab@macro.com".to_string(),
        page: 0,
        page_size: 10,
        match_type: "partial".to_string(),
        collapse: false,
        cursor: SearchCursorOption::NotDone(None),
        search_indices: HashSet::from([OpenSearchEntityType::Emails]),
        email_search_args: UnifiedEmailSearchArgs {
            terms: vec!["hello re".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let query_json = args.to_query_json().expect("failed to build query");
    println!("{}", serde_json::to_string_pretty(&query_json).unwrap());
}
