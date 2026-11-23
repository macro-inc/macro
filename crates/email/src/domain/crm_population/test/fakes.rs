use super::super::*;
use crate::domain::backfill_jobs::worker::{BackfillCrm, BackfillWritePermit};
use ::crm::domain::{
    email_policy_work::{EmailPolicyHistoryContact, EmailPolicyHistoryPage},
    email_privacy::EmailContributionMailbox,
    model::{CrmError, DepopulateContactOutcome},
};
use chrono::{DateTime, Utc};
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use models_email::service::backfill::{PopulateCrmContactPayload, PopulateCrmPolicyPayload};
use models_email::service::crm_population::CrmPopulationMessage;
use models_email::service::link::{Link, UserProvider};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

pub(super) const LINK: Uuid = Uuid::from_u128(10);
pub(super) const TEAM: Uuid = Uuid::from_u128(30);
pub(super) const CLAIM: Uuid = Uuid::from_u128(40);

pub(super) fn at(seconds: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(seconds, 0).unwrap()
}

pub(super) fn contact(email: &str) -> PopulateCrmContactPayload {
    PopulateCrmContactPayload {
        live_mail: true,
        contact_email: email.into(),
        contact_name: None,
        first_at: at(100),
        last_at: at(100),
        is_sent: false,
    }
}

pub(super) fn link() -> Link {
    Link {
        id: LINK,
        macro_id: MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap(),
        fusionauth_user_id: "owner".into(),
        email_address: EmailStr::try_from("owner@example.com".to_string()).unwrap(),
        provider: UserProvider::Gmail,
        is_sync_active: true,
        is_primary: true,
        needs_reauth: false,
        last_sync_error_at: None,
        created_at: Default::default(),
        updated_at: Default::default(),
    }
}

pub(super) fn page() -> PopulateCrmPolicyPayload {
    PopulateCrmPolicyPayload {
        team_id: TEAM,
        macro_id: MacroUserIdStr::try_from("macro|owner@example.com").unwrap(),
        link_id: LINK,
        work_id: Uuid::from_u128(50),
        consent_incarnation: Uuid::from_u128(60),
        policy_version: 7,
    }
}

/// What the fake returns and what it saw.
pub(super) struct State {
    pub calls: Vec<&'static str>,
    pub faults: HashSet<&'static str>,
    pub link: Option<Link>,
    pub team: Option<Uuid>,
    pub slot: bool,
    /// Whether `record` gives each request its entry; all when `None`.
    pub record: Option<Vec<bool>>,
    pub taken: PendingContact,
    pub attempts: u32,
    pub settled: SettledContact,
    pub populate: Option<fn() -> CrmError>,
    pub history: Option<EmailPolicyHistoryPage>,
    pub recorded: Vec<Vec<PopulateCrmContactPayload>>,
    /// The claims `record` was asked to give, failed or not.
    pub recorded_claims: Vec<Uuid>,
    pub released: Vec<Uuid>,
    pub sent: Vec<(Uuid, CrmPopulationMessage)>,
    pub populated: Vec<PopulateCrmContactPayload>,
    pub restored: Option<(Uuid, Uuid)>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            calls: vec![],
            faults: HashSet::new(),
            link: Some(link()),
            team: Some(TEAM),
            slot: true,
            record: None,
            taken: PendingContact::Missing,
            attempts: 0,
            settled: SettledContact::Cleared,
            populate: None,
            history: None,
            recorded: vec![],
            recorded_claims: vec![],
            released: vec![],
            sent: vec![],
            populated: vec![],
            restored: None,
        }
    }
}

#[derive(Clone, Default)]
pub(super) struct Fake(pub Arc<Mutex<State>>);

impl Fake {
    pub(super) fn calls(&self) -> Vec<&'static str> {
        self.0.lock().unwrap().calls.clone()
    }

    pub(super) fn fail(&self, call: &'static str) {
        self.0.lock().unwrap().faults.insert(call);
    }

    fn call(&self, name: &'static str) -> anyhow::Result<()> {
        let mut state = self.0.lock().unwrap();
        state.calls.push(name);
        if state.faults.contains(name) {
            anyhow::bail!("{name} failed");
        }
        Ok(())
    }

    fn crm_call(&self, name: &'static str) -> Result<(), CrmError> {
        self.call(name).map_err(CrmError::StorageLayerError)
    }

    pub(super) fn service(&self) -> CrmPopulationService<Fake, Fake, Fake, Fake, Fake> {
        CrmPopulationService {
            requests: CrmPopulationRequests {
                pending: self.clone(),
                queue: self.clone(),
            },
            slots: self.clone(),
            mailboxes: self.clone(),
            crm: self.clone(),
        }
    }
}

impl PendingContacts for Fake {
    async fn record(
        &self,
        link: Uuid,
        requests: &[(Uuid, PopulateCrmContactPayload)],
    ) -> anyhow::Result<Vec<bool>> {
        assert_eq!(link, LINK);
        {
            let mut state = self.0.lock().unwrap();
            state.recorded.push(
                requests
                    .iter()
                    .map(|(_, contact)| contact.clone())
                    .collect(),
            );
            state
                .recorded_claims
                .extend(requests.iter().map(|(claim, _)| *claim));
        }
        self.call("record")?;
        let state = self.0.lock().unwrap();
        Ok(match &state.record {
            Some(held) => held.clone(),
            None => vec![true; requests.len()],
        })
    }
    async fn release(
        &self,
        _: Uuid,
        claimed: &[(Uuid, PopulateCrmContactPayload)],
    ) -> anyhow::Result<()> {
        self.call("release_claims")?;
        let mut state = self.0.lock().unwrap();
        state
            .released
            .extend(claimed.iter().map(|(claim, _)| *claim));
        Ok(())
    }
    async fn take(
        &self,
        _: Uuid,
        _: &PopulateCrmContactPayload,
        claim: Uuid,
    ) -> anyhow::Result<PendingContact> {
        assert_eq!(claim, CLAIM);
        self.call("take")?;
        Ok(self.0.lock().unwrap().taken.clone())
    }
    async fn fail(
        &self,
        _: Uuid,
        _: &PopulateCrmContactPayload,
        _: Uuid,
    ) -> anyhow::Result<Option<u32>> {
        self.call("count_failure")?;
        let mut state = self.0.lock().unwrap();
        state.attempts += 1;
        Ok(Some(state.attempts))
    }
    async fn settle(
        &self,
        _: Uuid,
        _: &PopulateCrmContactPayload,
        claim: Uuid,
        _: Uuid,
    ) -> anyhow::Result<SettledContact> {
        assert_eq!(claim, CLAIM);
        self.call("settle")?;
        Ok(self.0.lock().unwrap().settled.clone())
    }
    async fn discard(
        &self,
        _: Uuid,
        _: &PopulateCrmContactPayload,
        claim: Uuid,
    ) -> anyhow::Result<()> {
        assert_eq!(claim, CLAIM);
        self.call("discard")?;
        Ok(())
    }
    async fn restore(
        &self,
        _: Uuid,
        _: &PopulateCrmContactPayload,
        claim: Uuid,
        next: Uuid,
    ) -> anyhow::Result<()> {
        self.call("restore")?;
        self.0.lock().unwrap().restored = Some((claim, next));
        Ok(())
    }
}

impl PopulationQueue for Fake {
    async fn send(&self, messages: Vec<(Uuid, CrmPopulationMessage)>) -> anyhow::Result<()> {
        self.call("send")?;
        self.0.lock().unwrap().sent.extend(messages);
        Ok(())
    }
}

impl PopulationSlots for Fake {
    type Slot = Fake;
    async fn fleet(&self) -> anyhow::Result<Option<Fake>> {
        self.call("fleet_slot")?;
        Ok(Some(self.clone()))
    }
    async fn team(&self, team: Uuid) -> anyhow::Result<Option<Fake>> {
        assert_eq!(team, TEAM);
        self.call("team_slot")?;
        Ok(self.0.lock().unwrap().slot.then(|| self.clone()))
    }
}

impl BackfillWritePermit for Fake {
    async fn hold<F: Future + Send>(self, work: F) -> F::Output
    where
        F::Output: Send,
    {
        self.call("hold").unwrap();
        let output = work.await;
        self.call("release").unwrap();
        output
    }
}

impl PopulationMailboxes for Fake {
    async fn link(&self, id: Uuid) -> anyhow::Result<Option<Link>> {
        assert_eq!(id, LINK);
        self.call("link")?;
        Ok(self.0.lock().unwrap().link.clone())
    }
}

impl BackfillCrm for Fake {
    async fn policy_history_page(
        &self,
        _: &PopulateCrmPolicyPayload,
    ) -> Result<Option<EmailPolicyHistoryPage>, CrmError> {
        self.crm_call("history_page")?;
        Ok(self.0.lock().unwrap().history.clone())
    }
    async fn populate_policy_contact(
        &self,
        _: &PopulateCrmPolicyPayload,
        _: &EmailPolicyHistoryPage,
        _: &EmailPolicyHistoryContact,
    ) -> Result<(), CrmError> {
        self.crm_call("history_contact")
    }
    async fn finish_policy_history_page(
        &self,
        _: &PopulateCrmPolicyPayload,
        _: &EmailPolicyHistoryPage,
    ) -> Result<(), CrmError> {
        self.crm_call("history_finish")
    }
    async fn get_team_id_for_user(&self, user: &str) -> Result<Option<Uuid>, CrmError> {
        assert_eq!(user, "macro|owner@example.com");
        self.crm_call("team")?;
        Ok(self.0.lock().unwrap().team)
    }
    async fn contribution_mailbox(
        &self,
        _: Uuid,
        _: &str,
    ) -> Result<Option<EmailContributionMailbox>, CrmError> {
        unreachable!("populations never resolve consent themselves")
    }
    async fn populate_contact(
        &self,
        team: &Uuid,
        link: &Link,
        contact: &PopulateCrmContactPayload,
    ) -> Result<(), CrmError> {
        assert_eq!((*team, link.id), (TEAM, LINK));
        self.call("populate").map_err(CrmError::StorageLayerError)?;
        let mut state = self.0.lock().unwrap();
        state.populated.push(contact.clone());
        match state.populate {
            Some(error) => Err(error()),
            None => Ok(()),
        }
    }
    async fn depopulate_contact(
        &self,
        _: &Uuid,
        _: &Uuid,
        _: &str,
    ) -> Result<DepopulateContactOutcome, CrmError> {
        unreachable!("populations never depopulate")
    }
    async fn depopulate_link_in_team(&self, _: &Uuid, _: &Uuid) -> Result<(), CrmError> {
        unreachable!("populations never depopulate")
    }
}
