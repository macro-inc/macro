use std::collections::HashMap;

use serde_json::json;
use wiremock::{Mock, Request, Respond, ResponseTemplate, matchers::method};

use crate::outlook::test::setup;
use email_api_client_core::models::{ProviderId, StreamPosition};
use email_api_client_core::ports::FolderChangeReader;

/// A folder's delta round as Microsoft Graph answers it, measured against a
/// real mailbox: a page holds as many ids as the request's
/// `Prefer: odata.maxpagesize` asks for (10 without it), a `$top` caps the
/// whole round rather than a page, and the round ends with a deltaLink on the
/// first page that comes back short. The nextLink carries where the round is
/// and its cap, never the page size.
struct GraphFolderDelta {
    root: String,
    messages: usize,
}

impl Respond for GraphFolderDelta {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        let query: HashMap<String, String> = request.url.query_pairs().into_owned().collect();
        let start: usize = query
            .get("$skiptoken")
            .map_or(0, |offset| offset.parse().unwrap());
        let cap = query
            .get("$top")
            .map_or(self.messages, |top| top.parse().unwrap())
            .min(self.messages);
        let page_size = request
            .headers
            .get_all("prefer")
            .iter()
            .flat_map(|value| value.to_str().unwrap().split(','))
            .find_map(|preference| preference.trim().strip_prefix("odata.maxpagesize="))
            .map_or(10, |size| size.parse().unwrap());
        let end = (start + page_size).min(cap);
        let value: Vec<_> = (start..end)
            .map(|index| json!({ "id": format!("message-{index}") }))
            .collect();
        let path = format!("{}/v1.0/me/mailFolders/inbox/messages/delta", self.root);
        let body = if end - start < page_size {
            json!({ "value": value, "@odata.deltaLink": format!("{path}?$deltatoken=round-end") })
        } else {
            let mut next = format!("{path}?$skiptoken={end}");
            if let Some(top) = query.get("$top") {
                next.push_str(&format!("&$top={top}"));
            }
            json!({ "value": value, "@odata.nextLink": next })
        };
        ResponseTemplate::new(200).set_body_json(body)
    }
}

#[tokio::test]
async fn a_folder_round_lists_every_message_past_the_first_hundred() {
    let (server, api, token) = setup().await;
    Mock::given(method("GET"))
        .respond_with(GraphFolderDelta {
            root: server.uri(),
            messages: 250,
        })
        .mount(&server)
        .await;

    let folder = ProviderId::new("inbox").unwrap();
    let mut listed = Vec::new();
    let mut position = None;
    let delta = loop {
        let page = api
            .folder_changes(&token, &folder, position.as_ref())
            .await
            .unwrap();
        listed.extend(page.changed);
        match page.position {
            StreamPosition::Continue(next) => position = Some(next),
            StreamPosition::Checkpoint(delta) => break delta,
        }
    };

    let every_message: Vec<_> = (0..250)
        .map(|index| ProviderId::new(format!("message-{index}")).unwrap())
        .collect();
    assert_eq!(listed.len(), 250);
    assert_eq!(listed, every_message);
    assert!(delta.expose().ends_with("$deltatoken=round-end"));
    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 3);
    for request in &requests {
        assert!(!request.url.query_pairs().any(|(name, _)| name == "$top"));
        let preferences: Vec<_> = request
            .headers
            .get_all("prefer")
            .iter()
            .map(|value| value.to_str().unwrap())
            .collect();
        assert_eq!(
            preferences,
            ["IdType=\"ImmutableId\"", "odata.maxpagesize=100"]
        );
    }
}
