use std::sync::Arc;

use macro_user_id::user_id::MacroUserIdStr;
use serde_json::json;

use super::*;
use crate::domain::model::TeamRole;

fn macro_user_id(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid macro user id")
}

fn test_events() -> Vec<TeamAnalyticsEvent> {
    let team_id = uuid::Uuid::from_u128(1);
    let team_invite_id = uuid::Uuid::from_u128(2);

    vec![
        TeamAnalyticsEvent::TeamCreated {
            team_id,
            owner_id: macro_user_id("macro|owner@example.com"),
            team_name: "Acme".to_string(),
        },
        TeamAnalyticsEvent::TeamInvited {
            team_id,
            team_invite_id,
            inviter_id: macro_user_id("macro|inviter@example.com"),
            team_name: Some("Acme".to_string()),
        },
        TeamAnalyticsEvent::TeamJoined {
            team_id,
            team_invite_id,
            member_id: macro_user_id("macro|member@example.com"),
            role: TeamRole::Member,
        },
        TeamAnalyticsEvent::TeamLeft {
            team_id,
            member_id: macro_user_id("macro|member@example.com"),
            removed_by_id: macro_user_id("macro|admin@example.com"),
            role: TeamRole::Admin,
        },
    ]
}

#[test]
fn maps_team_events_to_expected_posthog_names() {
    let expected_names = ["team_create", "team_invite", "team_join", "team_leave"];

    for (event, expected_name) in test_events().into_iter().zip(expected_names) {
        let posthog_event = PostHogTeamAnalyticsEvent::from_team_event(event);

        assert_eq!(posthog_event.event_name, expected_name);
    }
}

#[test]
fn mapped_team_events_include_team_id_in_properties() {
    let team_id = uuid::Uuid::from_u128(1).to_string();

    for event in test_events() {
        let posthog_event = PostHogTeamAnalyticsEvent::from_team_event(event);
        let properties = serde_json::to_value(&posthog_event.properties).unwrap();

        assert_eq!(properties["team_id"], team_id);
    }
}

#[test]
fn maps_team_created_context() {
    let posthog_event =
        PostHogTeamAnalyticsEvent::from_team_event(TeamAnalyticsEvent::TeamCreated {
            team_id: uuid::Uuid::from_u128(1),
            owner_id: macro_user_id("macro|owner@example.com"),
            team_name: "Acme".to_string(),
        });
    let properties = serde_json::to_value(&posthog_event.properties).unwrap();

    assert_eq!(posthog_event.distinct_id, "macro|owner@example.com");
    assert_eq!(
        properties,
        json!({
            "team_id": uuid::Uuid::from_u128(1),
            "team_name": "Acme",
            "owner_id": "macro|owner@example.com",
        })
    );
}

#[test]
fn maps_team_invited_context() {
    let posthog_event =
        PostHogTeamAnalyticsEvent::from_team_event(TeamAnalyticsEvent::TeamInvited {
            team_id: uuid::Uuid::from_u128(1),
            team_invite_id: uuid::Uuid::from_u128(2),
            inviter_id: macro_user_id("macro|inviter@example.com"),
            team_name: Some("Acme".to_string()),
        });
    let properties = serde_json::to_value(&posthog_event.properties).unwrap();

    assert_eq!(posthog_event.distinct_id, "macro|inviter@example.com");
    assert_eq!(
        properties,
        json!({
            "team_id": uuid::Uuid::from_u128(1),
            "team_name": "Acme",
            "team_invite_id": uuid::Uuid::from_u128(2),
            "inviter_id": "macro|inviter@example.com",
        })
    );
}

#[test]
fn maps_team_joined_context() {
    let posthog_event =
        PostHogTeamAnalyticsEvent::from_team_event(TeamAnalyticsEvent::TeamJoined {
            team_id: uuid::Uuid::from_u128(1),
            team_invite_id: uuid::Uuid::from_u128(2),
            member_id: macro_user_id("macro|member@example.com"),
            role: TeamRole::Member,
        });
    let properties = serde_json::to_value(&posthog_event.properties).unwrap();

    assert_eq!(posthog_event.distinct_id, "macro|member@example.com");
    assert_eq!(
        properties,
        json!({
            "team_id": uuid::Uuid::from_u128(1),
            "team_invite_id": uuid::Uuid::from_u128(2),
            "member_id": "macro|member@example.com",
            "role": "member",
        })
    );
}

#[test]
fn maps_team_left_context() {
    let posthog_event = PostHogTeamAnalyticsEvent::from_team_event(TeamAnalyticsEvent::TeamLeft {
        team_id: uuid::Uuid::from_u128(1),
        member_id: macro_user_id("macro|member@example.com"),
        removed_by_id: macro_user_id("macro|admin@example.com"),
        role: TeamRole::Admin,
    });
    let properties = serde_json::to_value(&posthog_event.properties).unwrap();

    assert_eq!(posthog_event.distinct_id, "macro|member@example.com");
    assert_eq!(
        properties,
        json!({
            "team_id": uuid::Uuid::from_u128(1),
            "member_id": "macro|member@example.com",
            "removed_by_id": "macro|admin@example.com",
            "role": "admin",
        })
    );
}

#[tokio::test]
async fn noop_analytics_client_adapter_returns_ok() {
    let analytics = AnalyticsClientTeamAnalytics::new(Arc::new(AnalyticsClient::noop()));

    analytics
        .track_team_event(TeamAnalyticsEvent::TeamCreated {
            team_id: uuid::Uuid::from_u128(1),
            owner_id: macro_user_id("macro|owner@example.com"),
            team_name: "Acme".to_string(),
        })
        .await
        .unwrap();
}
