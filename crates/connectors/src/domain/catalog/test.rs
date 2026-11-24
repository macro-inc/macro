use super::*;

#[test]
fn slack_v2_folds_to_slack_and_other_slugs_stay() {
    assert_eq!(canonical_slug("slack_v2"), "slack");
    assert_eq!(canonical_slug("slack"), "slack");
    assert_eq!(canonical_slug("linear"), "linear");
}

#[test]
fn overlay_server_is_found_by_any_spelling_of_its_url() {
    let overlays = Overlays::new([(
        ConnectorId::parse("sentry").unwrap(),
        ServerUrl::parse("https://mcp.sentry.dev/mcp").unwrap(),
    )]);

    let at = |url: &str| -> Vec<ConnectorId> {
        overlays
            .apps_at(&ServerUrl::parse(url).unwrap())
            .cloned()
            .collect()
    };
    assert_eq!(
        at("https://mcp.sentry.dev/mcp/"),
        vec![ConnectorId::parse("sentry").unwrap()]
    );
    assert!(at("https://mcp.sentry.dev/other").is_empty());
}

#[test]
fn a_shared_server_is_every_app_overlaid_at_it() {
    let url = ServerUrl::parse("https://mcp.example.com/mcp").unwrap();
    let first = ConnectorId::parse("alpha").unwrap();
    let second = ConnectorId::parse("beta").unwrap();

    for rows in [
        vec![(first.clone(), url.clone()), (second.clone(), url.clone())],
        vec![(second.clone(), url.clone()), (first.clone(), url.clone())],
    ] {
        let overlays = Overlays::new(rows);
        let apps: Vec<_> = overlays.apps_at(&url).cloned().collect();

        assert_eq!(apps, vec![first.clone(), second.clone()]);
        assert!(overlays.is_overlaid(&first) && overlays.is_overlaid(&second));
    }
}
