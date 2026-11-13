use std::sync::Mutex;

use chrono::{TimeZone, Utc};
use harness_id::HarnessId;
use hosted_runtimes::domain::ids::ComputerId;
use hosted_runtimes::domain::lifecycle::Failure;
use notification::domain::models::request::NotificationResult;
use notification::domain::models::{Notification, SendNotificationRequest};
use notification::domain::service::SendNotificationError;
use rootcause::Report;
use serde::Serialize;
use serde_json::json;
use team_agents::domain::models::{NewAgentAccount, PersonaSeed, TeamAgentRecord};

use super::*;

fn ready() -> SetupNotice {
    SetupNotice {
        computer_id: ComputerId::new_from_uuid(Uuid::from_u128(1)),
        team_id: Uuid::from_u128(2),
        harness_id: Some(HarnessId::new_from_uuid(Uuid::from_u128(
            0x0000_0000_0000_7000_8000_0000_0000_0c0c,
        ))),
        computer_name: "Build box".to_owned(),
        buyer: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
        agent: None,
        outcome: SetupOutcome::Ready,
    }
}

fn failed_at(hour: u32) -> SetupNotice {
    SetupNotice {
        harness_id: None,
        outcome: SetupOutcome::Failed {
            failure: Failure::Create,
            failed_at: Utc.with_ymd_and_hms(2026, 11, 13, hour, 0, 0).unwrap(),
        },
        ..ready()
    }
}

#[test]
fn every_delivery_of_an_outcome_has_one_notification_id_and_each_attempt_its_own() {
    let renamed = SetupNotice {
        computer_name: "Renamed box".to_owned(),
        ..ready()
    };
    let other_computer = SetupNotice {
        computer_id: ComputerId::new_from_uuid(Uuid::from_u128(3)),
        ..ready()
    };

    assert_eq!(notification_id(&ready()), notification_id(&renamed));
    assert_ne!(notification_id(&ready()), notification_id(&other_computer));
    assert_eq!(
        notification_id(&failed_at(12)),
        notification_id(&failed_at(12))
    );
    assert_ne!(
        notification_id(&failed_at(12)),
        notification_id(&failed_at(13))
    );
    assert_ne!(notification_id(&ready()), notification_id(&failed_at(12)));
}

#[derive(Default)]
struct CapturingIngress(Mutex<Vec<serde_json::Value>>);

impl NotificationIngress for CapturingIngress {
    async fn send_notification<
        'a,
        T: Notification + Clone + 'static,
        U: Serialize + Send + Sync + 'static,
    >(
        &'a self,
        req: SendNotificationRequest<'a, T, U>,
    ) -> Result<Option<NotificationResult<'a>>, Report<SendNotificationError>> {
        self.0
            .lock()
            .unwrap()
            .push(serde_json::to_value(&req).expect("request serializes"));
        Ok(None)
    }
}

/// The agents the notices read; only `get` is reached.
struct Agents(Vec<TeamAgentRecord>);

#[derive(Debug, thiserror::Error)]
#[error("unused")]
struct Unused;

impl TeamAgentRepository for Agents {
    type Err = Unused;

    async fn create_account(&self, _: &NewAgentAccount) -> Result<(), Unused> {
        Err(Unused)
    }

    async fn delete_account(&self, _: &MacroUserIdStr<'_>) -> Result<(), Unused> {
        Err(Unused)
    }

    async fn remove_seat(&self, _: &MacroUserIdStr<'_>) -> Result<(), Unused> {
        Err(Unused)
    }

    async fn get(&self, user_id: &MacroUserIdStr<'_>) -> Result<Option<TeamAgentRecord>, Unused> {
        Ok(self
            .0
            .iter()
            .find(|agent| agent.user_id.as_ref() == user_id.as_ref())
            .cloned())
    }

    async fn list_for_team(&self, _: Uuid) -> Result<Vec<TeamAgentRecord>, Unused> {
        Err(Unused)
    }
}

fn ada(created_by: Option<&str>) -> TeamAgentRecord {
    TeamAgentRecord {
        user_id: MacroUserIdStr::try_from("macro|ada@agents.macro.invalid".to_owned()).unwrap(),
        team_id: Uuid::from_u128(2),
        created_by: created_by
            .map(|inviter| MacroUserIdStr::try_from(inviter.to_owned()).unwrap()),
        persona_seed: PersonaSeed {
            creator_id: None,
            name: "Ada".to_owned(),
            job_description: "Triage support email.".to_owned(),
            personality: "Warm.".to_owned(),
            voice: None,
        },
        created_at: chrono::DateTime::UNIX_EPOCH,
    }
}

fn agent_ready() -> SetupNotice {
    SetupNotice {
        agent: Some(
            MacroUserIdStr::try_from("macro|ada@agents.macro.invalid".to_owned()).unwrap(),
        ),
        ..ready()
    }
}

async fn sent(notice: SetupNotice, agents: Vec<TeamAgentRecord>) -> Vec<serde_json::Value> {
    let ingress = Arc::new(CapturingIngress::default());
    let notices = IngressSetupNotices::new(Arc::clone(&ingress), Agents(agents));
    notices.send(notice).await.unwrap();
    ingress.0.lock().unwrap().clone()
}

#[tokio::test]
async fn a_plain_computers_notice_goes_to_its_buyer_without_an_agent() {
    let sent = sent(ready(), vec![]).await;

    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0]["req"]["recipient_ids"], json!(["macro|owner@example.com"]));
    assert_eq!(sent[0]["req"]["notification"]["content"].get("agent"), None);
}

#[tokio::test]
async fn an_agent_computers_notice_goes_to_the_agents_inviter_by_the_agents_name() {
    let sent = sent(agent_ready(), vec![ada(Some("macro|inviter@example.com"))]).await;

    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0]["req"]["recipient_ids"], json!(["macro|inviter@example.com"]));
    assert_eq!(
        sent[0]["req"]["notification"]["content"]["agent"],
        json!({ "userId": "macro|ada@agents.macro.invalid", "name": "Ada" })
    );
}

#[tokio::test]
async fn a_removed_agent_or_a_deleted_inviter_has_no_one_to_tell() {
    assert_eq!(sent(agent_ready(), vec![]).await, Vec::<serde_json::Value>::new());
    assert_eq!(
        sent(agent_ready(), vec![ada(None)]).await,
        Vec::<serde_json::Value>::new()
    );
}
