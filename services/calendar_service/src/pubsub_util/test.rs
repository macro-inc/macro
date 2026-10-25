use super::team_refresh_recipients;

fn found(users: &[&str]) -> Vec<Option<String>> {
    users.iter().map(|user| Some((*user).to_string())).collect()
}

#[test]
fn an_inbox_refresh_leaves_its_viewers_to_their_own_refresh() {
    let shared_by = [
        "macro|owner@example.com".to_string(),
        "macro|delegate@example.com".to_string(),
    ];

    let recipients = team_refresh_recipients(
        found(&[
            "macro|owner@example.com",
            "macro|delegate@example.com",
            "macro|teammate@example.com",
        ]),
        &shared_by,
        false,
    );

    assert_eq!(recipients, ["macro|teammate@example.com"]);
}

#[test]
fn a_sharing_change_also_refreshes_the_sharer() {
    let shared_by = ["macro|owner@example.com".to_string()];

    let recipients = team_refresh_recipients(
        found(&["macro|owner@example.com", "macro|teammate@example.com"]),
        &shared_by,
        true,
    );

    assert_eq!(
        recipients,
        ["macro|owner@example.com", "macro|teammate@example.com"]
    );
}
