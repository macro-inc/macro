use attention_feed::domain::models::CandidateRequest;
use attention_feed::inbound::viewers::FeedViewerResolver;
use attention_feed::test_support::{FakeSource, candidate, entity};
use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use futures::future::BoxFuture;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;

use super::FeedCandidateVisibility;
use crate::ping::FeedVisibility;

/// Nobody is on a team.
struct NoTeams;

impl FeedViewerResolver for NoTeams {
    fn team(
        &self,
        _user: MacroUserIdStr<'static>,
    ) -> BoxFuture<'_, Result<Option<EntityAccessReceipt<MemberTeamRole>>, rootcause::Report>> {
        Box::pin(async { Ok(None) })
    }
}

fn viewer() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap()
}

#[tokio::test]
async fn asks_only_the_inbox_with_the_link_probed() {
    let listed = entity(EntityType::Document, 1);
    let source = FakeSource::with(vec![candidate((), listed.clone(), Some(1), None)]);
    let feeds = FeedCandidateVisibility {
        source: source.clone(),
        viewers: NoTeams,
    };

    assert!(feeds.admits(&viewer(), &listed).await.unwrap());
    let requests = source.requests.lock().unwrap();
    let [request]: &[CandidateRequest] = &requests[..] else {
        panic!("one request, the inbox's: {requests:?}");
    };
    assert!(request.assume_attention);
    assert_eq!(request.viewer.user, viewer());
    assert_eq!(request.only, Some(vec![listed]));
}

#[tokio::test]
async fn refuses_what_the_inbox_would_not_list() {
    let feeds = FeedCandidateVisibility {
        source: FakeSource::<()>::with(Vec::new()),
        viewers: NoTeams,
    };

    assert!(
        !feeds
            .admits(&viewer(), &entity(EntityType::Document, 1))
            .await
            .unwrap()
    );
}
