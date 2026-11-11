use attention_feed::test_support::{FakeSource, candidate, entity};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;

use super::FeedCandidateVisibility;
use crate::manual::{FeedVerdict, FeedVisibility};

#[tokio::test]
async fn lists_what_the_inbox_and_home_candidate_requests_return() {
    let listed = entity(EntityType::Document, 1);
    let source = FakeSource::with(vec![candidate((), listed.clone(), Some(1), None)]);
    let feeds = FeedCandidateVisibility(source.clone());
    let viewer = MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap();

    assert_eq!(
        feeds.admits(&viewer, &listed).await.unwrap(),
        FeedVerdict::Listed
    );
    let requests = source.requests.lock().unwrap();
    assert_eq!(requests.len(), 2, "the inbox, then Home");
    assert!(requests.iter().all(|request| request.assume_attention
        && request.viewer.user == viewer
        && request.only == Some(vec![listed.clone()])));
}

#[tokio::test]
async fn names_the_inbox_when_neither_feed_lists_it() {
    let feeds = FeedCandidateVisibility(FakeSource::<()>::with(Vec::new()));
    let viewer = MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap();

    assert_eq!(
        feeds
            .admits(&viewer, &entity(EntityType::Document, 1))
            .await
            .unwrap(),
        FeedVerdict::NotListed(crate::manual::Feed::Inbox)
    );
}
