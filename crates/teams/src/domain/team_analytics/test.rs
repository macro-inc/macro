use macro_user_id::user_id::MacroUserIdStr;

use super::*;

fn macro_user_id(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid macro user id")
}

#[tokio::test]
async fn no_op_team_analytics_accepts_all_event_variants() {
    let analytics = NoOpTeamAnalytics;
    let team_id = uuid::Uuid::from_u128(1);
    let team_invite_id = uuid::Uuid::from_u128(2);

    let events = [
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
            role: TeamRole::Member,
        },
    ];

    for event in events {
        analytics.track_team_event(event).await.unwrap();
    }
}
