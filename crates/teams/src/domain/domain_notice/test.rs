use std::sync::Mutex;

use model_entity::EntityType;
use uuid::Uuid;

use super::*;
use crate::domain::join_announcement::JoinAnnouncementError;

const TEAM: Uuid = Uuid::from_u128(0x2222);

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

fn receipt(sender: &str) -> EntityAccessReceipt<AdminTeamRole> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        user(sender),
        &TEAM.to_string(),
        EntityType::Team,
    )
}

struct FakeDirectory {
    contacts: Vec<&'static str>,
    fail: bool,
}

impl ColleagueDirectory for FakeDirectory {
    async fn contacts(
        &self,
        _user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        if self.fail {
            return Err(rootcause::report!("contacts unavailable"));
        }
        Ok(self.contacts.iter().map(|email| user(email)).collect())
    }
}

#[derive(Default)]
struct FakeAnnouncer {
    requests: Mutex<Vec<AnnounceJoin>>,
}

impl JoinAnnouncementService for FakeAnnouncer {
    async fn announce_join(
        &self,
        request: AnnounceJoin,
    ) -> Result<AnnounceReport, Report<JoinAnnouncementError>> {
        let sent = request.candidates.len() as u32;
        self.requests.lock().unwrap().push(request);
        Ok(AnnounceReport {
            claimed: sent,
            sent,
            released: 0,
        })
    }
}

#[tokio::test]
async fn only_contacts_on_the_senders_domain_are_announced_to() {
    let service = DomainNoticeServiceImpl::new(
        FakeDirectory {
            contacts: vec!["bob@acme.com", "eve@other.com", "Carol@ACME.com"],
            fail: false,
        },
        FakeAnnouncer::default(),
    );

    let report = service
        .send_domain_notice(receipt("alice@acme.com"))
        .await
        .unwrap();

    assert_eq!(report.sent, 2);
    let requests = service.announcer.requests.lock().unwrap();
    let [request] = requests.as_slice() else {
        panic!("expected one announcement");
    };
    assert_eq!(request.team_id, TEAM);
    assert_eq!(request.joined, user("alice@acme.com"));
    assert_eq!(request.joined_name, None);
    let candidates: Vec<&str> = request.candidates.iter().map(|c| c.email_str()).collect();
    assert_eq!(candidates, vec!["bob@acme.com", "Carol@ACME.com"]);
}

#[tokio::test]
async fn a_contacts_failure_sends_nothing() {
    let service = DomainNoticeServiceImpl::new(
        FakeDirectory {
            contacts: vec!["bob@acme.com"],
            fail: true,
        },
        FakeAnnouncer::default(),
    );

    let error = service
        .send_domain_notice(receipt("alice@acme.com"))
        .await
        .unwrap_err();

    assert_eq!(*error.current_context(), DomainNoticeError::Storage);
    assert!(service.announcer.requests.lock().unwrap().is_empty());
}
