use super::*;
use macro_user_id::cowlike::CowLike;

#[test]
fn a_team_channel_is_owned_by_the_owner_and_auto_joined() {
    let team_id = Uuid::from_u128(7);
    let owner = MacroUserIdStr::parse_from_str("macro|owner@example.com")
        .unwrap()
        .into_owned();
    let request = team_channel_request(team_id, "Persisted Team Name".to_string(), owner.clone());
    assert_eq!(request.name.as_deref(), Some("Persisted Team Name"));
    assert_eq!(request.channel_type, ChannelType::Team);
    assert_eq!(request.team_id, Some(team_id));
    assert!(request.auto_join_team);
    assert_eq!(request.participants, HashSet::from([owner]));
}
