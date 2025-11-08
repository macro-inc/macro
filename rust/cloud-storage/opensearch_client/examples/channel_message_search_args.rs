use opensearch_client::search::channels::ChannelMessageSearchArgs;

fn main() {
    let advanced_args = ChannelMessageSearchArgs {
        terms: vec!["project".to_string(), "deadline".to_string()],
        user_id: "user456".to_string(),
        channel_ids: vec!["general".to_string(), "development".to_string()],
        page: 1,
        page_size: 20,
        match_type: "exact".to_string(),
        org_id: Some(42),
        thread_ids: vec!["thread1".to_string(), "thread2".to_string()],
        mentions: vec!["@alice".to_string(), "@bob".to_string()],
        ..Default::default()
    };

    match advanced_args.build() {
        Ok(json) => println!("{}", serde_json::to_string_pretty(&json).unwrap()),
        Err(e) => eprintln!("Error building advanced query: {:?}", e),
    }
}
