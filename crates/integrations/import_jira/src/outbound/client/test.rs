use super::*;
#[path = "../../../../import_tracker/test_support.rs"]
mod support;

#[test]
fn every_request_only_reads() {
    let cloud = ObjectId::parse("site-123").unwrap();
    let issue = ObjectId::parse("10001").unwrap();
    let reads = [
        JiraRead::Resources,
        JiraRead::Projects {
            cloud: cloud.clone(),
            start: 0,
        },
        JiraRead::Search {
            cloud: cloud.clone(),
            token: Some("opaque".into()),
        },
        JiraRead::Comments {
            cloud: cloud.clone(),
            issue,
            start: 0,
        },
        JiraRead::Users {
            cloud: cloud.clone(),
            start: 0,
        },
        JiraRead::Fields { cloud },
    ];
    for read in reads {
        match read {
            JiraRead::Search { .. } => {
                assert_eq!(read.method(), Method::POST);
                assert!(read.url().ends_with("/search/jql"));
                assert_eq!(read.body().unwrap()["nextPageToken"], "opaque");
            }
            JiraRead::Resources
            | JiraRead::Projects { .. }
            | JiraRead::Comments { .. }
            | JiraRead::Users { .. }
            | JiraRead::Fields { .. } => {
                assert_eq!(read.method(), Method::GET);
                assert!(read.body().is_none());
            }
        }
    }
}

#[tokio::test(start_paused = true)]
async fn enhanced_search_uses_next_page_token_and_site_namespace() {
    let proxy = Arc::new(support::Proxy::new(vec![
        json!({"values":[{"id":"100","key":"ENG","name":"Engineering"},{"id":"bad/id"}],"isLast":true}),
        json!([{"accountId":"u1","displayName":"A"},{"displayName":"Broken"}]),
        json!([]),
        json!({"issues":[],"isLast":false,"nextPageToken":"second"}),
        json!({"issues":[],"isLast":true}),
    ]));
    let user = MacroUserIdStr::try_from_email("owner@example.com").unwrap();
    let connections = Connections::new(
        Arc::new(support::Store),
        Some(proxy.clone()),
        "jira",
        Duration::ZERO,
    );
    let client = Client(connections.open(&user).await.unwrap());
    let site = Site {
        id: ObjectId::parse("site-1").unwrap(),
        name: "Site".into(),
        url: "https://example.atlassian.net".into(),
        scopes: vec!["read:jira-work".into()],
    };
    let mut inventory = Inventory::default();
    client
        .site(&site, &mut inventory, &|_, _| {})
        .await
        .unwrap();
    assert_eq!(inventory.groups.len(), 1);
    assert_eq!(inventory.users.len(), 1);
    assert_eq!(inventory.warnings.len(), 2);
    assert_eq!(
        proxy.requests.lock().unwrap()[4].2.as_ref().unwrap()["nextPageToken"],
        "second"
    );
    assert_eq!(
        scoped(&site.id, &ObjectId::parse("100").unwrap())
            .unwrap()
            .as_str(),
        "site-1:100"
    );
}
