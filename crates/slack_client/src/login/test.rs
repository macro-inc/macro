use super::*;

#[test]
fn found_workspaces_carry_their_icon_and_enterprise_org() {
    let found: FoundWorkspaces = serde_json::from_value(serde_json::json!({
        "current_teams": [{"email": "a@example.com", "teams": [
            {"id": "T0OWNTEAM1", "name": "Own", "domain": "own", "icon": {"image_88": "https://a.slack-edge.com/own_88.png"}}
        ]}],
        "current_orgs": [{"email": "a@example.com",
            "org": {"id": "E0GRIDORG1", "name": "Grid Org", "domain": "grid"},
            "teams": [{"id": "T0GRIDTEAM", "name": "Grid Team", "domain": "grid-team", "sso_required": true}]
        }]
    }))
    .unwrap();
    let workspaces = flatten_workspaces(found);
    let views: Vec<(&str, Option<&str>, Option<&str>, bool)> = workspaces
        .iter()
        .map(|workspace| {
            (
                workspace.team_id.as_str(),
                workspace.icon_url.as_deref(),
                workspace.enterprise_name.as_deref(),
                workspace.sso_required,
            )
        })
        .collect();
    assert_eq!(
        views,
        vec![
            (
                "T0OWNTEAM1",
                Some("https://a.slack-edge.com/own_88.png"),
                None,
                false
            ),
            ("E0GRIDORG1", None, Some("Grid Org"), false),
            ("T0GRIDTEAM", None, Some("Grid Org"), true),
        ]
    );
}
