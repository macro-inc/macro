use attention_feed::domain::models::CandidateRequest;
use attention_feed::inbound::viewers::FeedViewerResolver;
use attention_feed::test_support::{FakeSource, candidate, entity};
use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use futures::future::BoxFuture;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;

use super::{FeedCandidateVisibility, SharedName, channel_name, shared};
use crate::ping::FeedVisibility;
use models_soup::comms::ChannelType;

/// Test sources carry no names.
impl SharedName for () {
    fn shared_name(&self) -> Option<String> {
        None
    }
}

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

    assert!(feeds.listing(&viewer(), &listed).await.unwrap().is_some());
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
        feeds
            .listing(&viewer(), &entity(EntityType::Document, 1))
            .await
            .unwrap()
            .is_none()
    );
}

#[test]
fn names_a_channel_the_way_its_messages_do_and_a_direct_message_not_at_all() {
    assert_eq!(
        channel_name(ChannelType::Public, Some("launch")).as_deref(),
        Some("#launch")
    );
    assert_eq!(
        channel_name(ChannelType::Team, Some("eng")).as_deref(),
        Some("#eng")
    );
    assert_eq!(
        channel_name(ChannelType::Private, Some("Offsite")).as_deref(),
        Some("Offsite")
    );
    // Each side of a direct message names it after the other.
    assert_eq!(channel_name(ChannelType::DirectMessage, Some("Ada")), None);
    // A group chat without a name has none to share.
    assert_eq!(channel_name(ChannelType::Private, None), None);
}

#[test]
fn a_blank_name_is_no_name() {
    assert_eq!(shared(Some("  Q3 plan ")).as_deref(), Some("Q3 plan"));
    assert_eq!(shared(Some(" \n ")), None);
    assert_eq!(channel_name(ChannelType::Public, Some("  ")), None);
    assert_eq!(shared(None), None);
}
