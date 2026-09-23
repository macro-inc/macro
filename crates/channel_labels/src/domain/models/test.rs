use super::ChannelLabelsScope;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

#[test]
fn shared_labels_accept_only_channels_owned_by_their_team() {
    let team_id = Uuid::now_v7();
    let scope = ChannelLabelsScope::Team(team_id);

    assert!(scope.can_label_channel(Some(team_id)));
    assert!(!scope.can_label_channel(Some(Uuid::now_v7())));
    assert!(!scope.can_label_channel(None));
}

#[test]
fn private_labels_accept_team_channels_and_reject_non_team_channels() {
    let user_id = MacroUserIdStr::try_from("macro|labels@macro.com".to_owned()).unwrap();
    let scope = ChannelLabelsScope::User(user_id);

    assert!(scope.can_label_channel(Some(Uuid::now_v7())));
    assert!(!scope.can_label_channel(None));
}
