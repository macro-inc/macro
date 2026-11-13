use macro_event_broker::exposure::{Audience, EntityType, Exposure};
use serde_json::json;
use uuid::Uuid;

use super::*;

fn updated(foreign_entity_ids: Vec<Uuid>) -> GithubPullRequestTopicEvent {
    GithubPullRequestTopicEvent::Updated(GithubPullRequestUpdated {
        github_key: "Macro-Inc/Repo/pull/7".to_owned(),
        foreign_entity_ids,
    })
}

#[test]
fn an_update_reaches_everyone_who_can_see_a_linked_record() {
    let event = updated(vec![Uuid::from_u128(1), Uuid::from_u128(2)]);
    let Exposure::Public(public) = event.exposure().unwrap() else {
        panic!("a linked update is public");
    };

    assert_eq!(public.entity.entity_type.as_str(), "github_pull_request");
    assert_eq!(public.entity.entity_id, "macro-inc/repo/pull/7");
    assert_eq!(
        public.audience,
        Audience::Any(vec![
            Audience::Entity {
                entity_type: EntityType::ForeignEntity,
                entity_id: Uuid::from_u128(1).to_string(),
            },
            Audience::Entity {
                entity_type: EntityType::ForeignEntity,
                entity_id: Uuid::from_u128(2).to_string(),
            },
        ])
    );
    assert_eq!(
        serde_json::to_value(public.payload.as_ref()).unwrap(),
        json!({
            "event_type": "github_pull_request.updated",
            "metadata": {"github_key": "macro-inc/repo/pull/7"},
        })
    );
}

#[test]
fn an_update_with_no_linked_record_stays_internal() {
    assert!(matches!(
        updated(Vec::new()).exposure().unwrap(),
        Exposure::Internal(_)
    ));
}

#[cfg(feature = "schema")]
#[test]
fn public_payload_has_a_schema() {
    use utoipa::ToSchema as _;
    assert_eq!(
        GithubPullRequestPublicEvent::name(),
        "GithubPullRequestPublicEvent"
    );
}
