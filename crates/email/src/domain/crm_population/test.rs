use super::*;
use chrono::{DateTime, Utc};
use models_email::service::backfill::PopulateCrmContactPayload;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use uuid::Uuid;

const TEAM: Uuid = Uuid::from_u128(7);

/// What the fake ledger was asked to record.
#[derive(Debug, Clone, PartialEq)]
enum Settled {
    Completed,
    Failed {
        error: String,
        retry_after: Option<Duration>,
        mailbox_failures: u32,
        pause: Duration,
    },
    Released,
}

#[derive(Clone, Default)]
struct Ledger {
    settled: Arc<Mutex<Vec<Settled>>>,
    unavailable: bool,
}

impl Ledger {
    fn record(&self, settled: Settled) -> Result<(), Report> {
        if self.unavailable {
            rootcause::bail!("ledger unavailable");
        }
        self.settled.lock().unwrap().push(settled);
        Ok(())
    }
}

impl CrmPopulationLedger for Ledger {
    async fn claim(&self, _: Uuid, _: Duration, _: Concurrency) -> Result<Claim, Report> {
        Ok(Claim {
            claimed: None,
            resume_after: None,
            busy: false,
        })
    }
    async fn complete(&self, _: &ClaimedPopulation, _: Duration) -> Result<Completion, Report> {
        self.record(Settled::Completed)?;
        Ok(Completion::Removed)
    }
    async fn fail(&self, _: &ClaimedPopulation, failure: &FailedAttempt<'_>) -> Result<(), Report> {
        self.record(Settled::Failed {
            error: failure.error.to_owned(),
            retry_after: failure.retry_after,
            mailbox_failures: failure.mailbox_failures,
            pause: failure.pause,
        })
    }
    async fn release(&self, _: &ClaimedPopulation) -> Result<(), Report> {
        self.record(Settled::Released)
    }
}

/// How the fake CRM answers a population.
#[derive(Clone)]
enum Crm {
    Populates,
    NoTeam,
    TeamLookupFails,
    Fails(fn() -> CrmError),
    NeverAnswers,
}

#[derive(Clone)]
struct FakeCrm {
    behaviour: Crm,
    populated: Arc<Mutex<Vec<(Uuid, String)>>>,
}

impl CrmPopulator for FakeCrm {
    async fn team(&self, _: &str) -> Result<Option<Uuid>, CrmError> {
        match self.behaviour {
            Crm::NoTeam => Ok(None),
            Crm::TeamLookupFails => Err(CrmError::StorageLayerError(
                anyhow::anyhow!("connection refused").context("team lookup"),
            )),
            _ => Ok(Some(TEAM)),
        }
    }
    async fn populate(&self, team: Uuid, claimed: &ClaimedPopulation) -> Result<(), CrmError> {
        self.populated
            .lock()
            .unwrap()
            .push((team, claimed.request.contact_email.clone()));
        match self.behaviour {
            Crm::Fails(error) => Err(error()),
            Crm::NeverAnswers => std::future::pending().await,
            _ => Ok(()),
        }
    }
}

fn service(behaviour: Crm) -> CrmPopulationService<Ledger, FakeCrm> {
    CrmPopulationService {
        ledger: Ledger::default(),
        crm: FakeCrm {
            behaviour,
            populated: Arc::default(),
        },
    }
}

fn at(seconds: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(seconds, 0).unwrap()
}

fn claimed(attempt: u8, mailbox_failures: u32) -> ClaimedPopulation {
    ClaimedPopulation {
        link_id: Uuid::from_u128(1),
        owner: "macro|owner@example.com".into(),
        mailbox: "owner@example.com".into(),
        request: PopulateCrmContactPayload {
            contact_email: "friend@acme.example".into(),
            contact_name: None,
            first_at: at(100),
            last_at: at(200),
            is_sent: true,
        },
        generation: 1,
        attempt,
        lease: at(1_000),
        mailbox_failures,
        traceparent: None,
    }
}

fn settled(service: &CrmPopulationService<Ledger, FakeCrm>) -> Vec<Settled> {
    service.ledger.settled.lock().unwrap().clone()
}

#[tokio::test]
async fn a_population_that_succeeds_completes_its_request() {
    let service = service(Crm::Populates);
    assert_eq!(
        service.attempt(&claimed(1, 0)).await,
        PopulationOutcome::Populated
    );
    assert_eq!(settled(&service), [Settled::Completed]);
    assert_eq!(
        *service.crm.populated.lock().unwrap(),
        [(TEAM, "friend@acme.example".to_owned())]
    );
}

#[tokio::test]
async fn requests_that_can_never_apply_are_dropped_not_retried() {
    for behaviour in [
        Crm::NoTeam,
        Crm::Fails(|| CrmError::CrmDisabledForTeam),
        Crm::Fails(|| CrmError::InvalidRequest("email has no '@' separator".into())),
    ] {
        let service = service(behaviour);
        assert_eq!(
            service.attempt(&claimed(1, 0)).await,
            PopulationOutcome::Discarded
        );
        assert_eq!(settled(&service), [Settled::Completed]);
    }
}

#[tokio::test]
async fn a_failed_attempt_is_retried_later_and_pauses_its_mailbox() {
    let service = service(Crm::Fails(|| CrmError::Contended));
    assert_eq!(
        service.attempt(&claimed(1, 0)).await,
        PopulationOutcome::Retrying
    );
    assert_eq!(
        settled(&service),
        [Settled::Failed {
            error: CrmError::Contended.to_string(),
            retry_after: Some(Duration::from_secs(60)),
            mailbox_failures: 1,
            pause: Duration::from_secs(15),
        }]
    );
}

#[tokio::test]
async fn a_failure_is_recorded_with_every_cause() {
    let service = service(Crm::Fails(|| {
        CrmError::StorageLayerError(
            anyhow::anyhow!("deadlock detected")
                .context("merge company interactions")
                .context("populate contact"),
        )
    }));
    service.attempt(&claimed(3, 2)).await;
    assert_eq!(
        settled(&service),
        [Settled::Failed {
            error: "populate contact: merge company interactions: deadlock detected".into(),
            retry_after: Some(Duration::from_secs(240)),
            mailbox_failures: 3,
            pause: Duration::from_secs(60),
        }]
    );

    let service = self::service(Crm::TeamLookupFails);
    service.attempt(&claimed(1, 0)).await;
    assert!(matches!(
        settled(&service).as_slice(),
        [Settled::Failed { error, .. }] if error == "team lookup: connection refused"
    ));
}

#[tokio::test]
async fn the_last_attempt_parks_its_request() {
    let service = service(Crm::Fails(|| CrmError::Contended));
    assert_eq!(
        service.attempt(&claimed(MAX_ATTEMPTS, 0)).await,
        PopulationOutcome::Parked
    );
    assert!(matches!(
        settled(&service).as_slice(),
        [Settled::Failed {
            retry_after: None,
            ..
        }]
    ));
}

#[tokio::test]
async fn a_request_whose_attempts_never_settled_is_parked_unattempted() {
    let service = service(Crm::Populates);
    assert_eq!(
        service.attempt(&claimed(MAX_ATTEMPTS + 1, 0)).await,
        PopulationOutcome::Parked
    );
    assert!(service.crm.populated.lock().unwrap().is_empty());
    assert!(matches!(
        settled(&service).as_slice(),
        [Settled::Failed {
            retry_after: None,
            ..
        }]
    ));
}

#[tokio::test(start_paused = true)]
async fn an_attempt_without_an_outcome_fails_at_its_deadline() {
    let service = service(Crm::NeverAnswers);
    assert_eq!(
        service.attempt(&claimed(1, 0)).await,
        PopulationOutcome::Retrying
    );
    assert!(matches!(
        settled(&service).as_slice(),
        [Settled::Failed { error, retry_after: Some(_), .. }] if error == "no outcome within 240s"
    ));
}

#[tokio::test]
async fn an_outcome_the_ledger_cannot_record_is_left_to_the_lease() {
    for behaviour in [Crm::Populates, Crm::Fails(|| CrmError::Contended)] {
        let mut service = service(behaviour);
        service.ledger.unavailable = true;
        assert_eq!(
            service.attempt(&claimed(1, 0)).await,
            PopulationOutcome::Unsettled
        );
        service.release(&claimed(1, 0)).await;
        assert!(settled(&service).is_empty());
    }
}

#[tokio::test]
async fn an_interrupted_attempt_is_released() {
    let service = service(Crm::Populates);
    service.release(&claimed(1, 0)).await;
    assert_eq!(settled(&service), [Settled::Released]);
}

#[test]
fn retries_double_from_a_minute_to_an_hour_and_then_stop() {
    let delays: Vec<_> = (1..=MAX_ATTEMPTS)
        .map(|attempt| retry_after(attempt).map(|delay| delay.as_secs()))
        .collect();
    assert_eq!(
        delays,
        [
            Some(60),
            Some(120),
            Some(240),
            Some(480),
            Some(960),
            Some(1920),
            Some(3600),
            None
        ]
    );
    assert_eq!(retry_after(u8::MAX), None);
}

#[test]
fn mailbox_pauses_double_from_seconds_to_half_an_hour() {
    let pauses: Vec<_> = [1, 2, 3, 7, 8, 9, u32::MAX]
        .map(|failures| pause_after(failures).as_secs())
        .into();
    assert_eq!(pauses, [15, 30, 60, 960, 1800, 1800, 1800]);
}

#[test]
fn an_attempt_settles_before_its_lease_lapses() {
    assert!(ATTEMPT_TIMEOUT < LEASE);
    assert!(SETTLE < MAX_POSTPONE);
}

#[test]
fn requests_are_normalized_distinct_and_never_for_the_mailbox_itself() {
    let contacts = [
        (" First@Example.com ", Some("First")),
        ("@example.com", Some("No local part")),
        ("local@", Some("No domain")),
        ("local@extra@example.com", Some("Two separators")),
        ("not an address", None),
        ("Second@Example.com", None),
        (" Owner@Example.com ", Some("Self")),
        ("first@example.com", Some("Duplicate")),
    ]
    .map(|(email, name)| (email.to_owned(), name.map(str::to_owned), at(1), at(2)));

    let requests = population_requests("owner@example.com", contacts, true);

    assert_eq!(
        requests,
        [
            PopulateCrmContactPayload {
                contact_email: "first@example.com".into(),
                contact_name: Some("First".into()),
                first_at: at(1),
                last_at: at(2),
                is_sent: true,
            },
            PopulateCrmContactPayload {
                contact_email: "second@example.com".into(),
                contact_name: None,
                first_at: at(1),
                last_at: at(2),
                is_sent: true,
            },
        ]
    );
}
