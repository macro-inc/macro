use serde_json::{Value, json};
use std::collections::HashSet;
use uuid::{Uuid, uuid};
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

use super::*;

const OWNER: &str = "macro|views-owner@example.com";
const MEMBER: &str = "macro|views-member@example.com";
const TEAM: Uuid = uuid!("11111111-1111-7111-8111-111111111111");
const MISSING_TEAM: Uuid = uuid!("22222222-2222-7222-8222-222222222222");

/// The owner and one teammate belong to `TEAM`; looking up any other team fails.
struct FixtureTeam;

#[derive(Debug, thiserror::Error)]
#[error("team lookup failed")]
struct LookupFailed;

impl MembershipPort for FixtureTeam {
    type Err = LookupFailed;

    async fn viewer_teams(&self, _viewer: &str) -> Result<Vec<Uuid>, Self::Err> {
        Ok(vec![TEAM])
    }

    async fn team_members(&self, team: Uuid) -> Result<HashSet<String>, Self::Err> {
        if team != TEAM {
            return Err(LookupFailed);
        }
        Ok(HashSet::from([OWNER.to_owned(), MEMBER.to_owned()]))
    }
}

async fn gateway() -> (MockServer, ConnectionGatewayClient) {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/message/batch_send"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "receipts": [] })))
        .mount(&server)
        .await;
    let client = ConnectionGatewayClient::new("test".to_string(), server.uri());
    (server, client)
}

/// Signal `change` and wait for its push, as shutdown drains it.
async fn signal(client: ConnectionGatewayClient, change: ViewsChanged) {
    let tasks = TaskTracker::new();
    ConnectionGatewaySavedViewChanges::new(client, Arc::new(FixtureTeam), tasks.clone())
        .views_changed(change)
        .await;
    tasks.close();
    tasks.wait().await;
}

/// `(message_type, message, recipients)` of every push the gateway received.
async fn pushes(server: &MockServer) -> Vec<(Value, Value, Vec<String>)> {
    server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .map(|request| {
            let body: Value = request.body_json().unwrap();
            let mut recipients: Vec<String> = body["entities"]
                .as_array()
                .unwrap()
                .iter()
                .map(|entity| entity["entity_id"].as_str().unwrap().to_owned())
                .collect();
            recipients.sort();
            (
                body["message_type"].clone(),
                body["message"].clone(),
                recipients,
            )
        })
        .collect()
}

#[tokio::test]
async fn a_shared_change_reaches_its_author_and_each_teammate_once() {
    let (server, client) = gateway().await;

    signal(
        client,
        ViewsChanged {
            kind: Some("email".to_owned()),
            user: OWNER.to_owned(),
            teams: vec![TEAM],
        },
    )
    .await;

    assert_eq!(
        pushes(&server).await,
        vec![(
            json!("saved_views_changed"),
            json!({ "kind": "email" }),
            vec![MEMBER.to_owned(), OWNER.to_owned()],
        )]
    );
}

#[tokio::test]
async fn a_failed_team_lookup_still_tells_the_author() {
    let (server, client) = gateway().await;

    signal(
        client,
        ViewsChanged {
            kind: None,
            user: OWNER.to_owned(),
            teams: vec![MISSING_TEAM],
        },
    )
    .await;

    assert_eq!(
        pushes(&server).await,
        vec![(
            json!("saved_views_changed"),
            json!({ "kind": null }),
            vec![OWNER.to_owned()],
        )]
    );
}
