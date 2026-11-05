use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use email_api_client::domain::models::RateLimitOrigin;
use macro_user_id::email::EmailStr;

use super::*;

const GMAIL_LINK: Uuid = Uuid::from_u128(0x11);
const OUTLOOK_LINK: Uuid = Uuid::from_u128(0x22);
const DELEGATED_LINK: Uuid = Uuid::from_u128(0x33);
const PAUSED_LINK: Uuid = Uuid::from_u128(0x44);

fn actor() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap()
}

fn link(id: Uuid, owner: &'static str, provider: UserProvider, is_sync_active: bool) -> Link {
    Link {
        id,
        macro_id: MacroUserIdStr::parse_from_str(owner).unwrap(),
        fusionauth_user_id: String::new(),
        email_address: EmailStr::try_from("inbox@example.com".to_owned()).unwrap(),
        provider,
        is_sync_active,
        is_primary: false,
        needs_reauth: false,
        last_sync_error_at: None,
        created_at: Default::default(),
        updated_at: Default::default(),
    }
}

fn key(link_id: Uuid) -> MailboxKey {
    MailboxKey {
        link_id,
        sync_generation: 3,
        grant_generation: 7,
    }
}

fn domain(value: &str) -> SenderDomain {
    SenderDomain::new(value).unwrap()
}

/// The actor's Gmail and Outlook inboxes, an inbox delegated to them, and one
/// of their own whose sync is off.
struct Mailboxes;

impl SenderDomainMailboxes for Mailboxes {
    async fn accessible_inboxes(&self, _: &MacroUserIdStr<'_>) -> Result<Vec<Link>, MailboxError> {
        Ok(vec![
            link(
                GMAIL_LINK,
                "macro|owner@example.com",
                UserProvider::Gmail,
                true,
            ),
            link(
                OUTLOOK_LINK,
                "macro|owner@example.com",
                UserProvider::Outlook,
                true,
            ),
            link(
                DELEGATED_LINK,
                "macro|boss@example.com",
                UserProvider::Gmail,
                true,
            ),
            link(
                PAUSED_LINK,
                "macro|owner@example.com",
                UserProvider::Gmail,
                false,
            ),
        ])
    }

    async fn binding(&self, link_id: Uuid) -> Result<Option<MailboxKey>, MailboxError> {
        Ok(Some(key(link_id)))
    }
}

struct NoMailboxes;

impl SenderDomainMailboxes for NoMailboxes {
    async fn accessible_inboxes(&self, _: &MacroUserIdStr<'_>) -> Result<Vec<Link>, MailboxError> {
        Ok(Vec::new())
    }

    async fn binding(&self, _: Uuid) -> Result<Option<MailboxKey>, MailboxError> {
        Ok(None)
    }
}

/// What a query for a mailbox and domain answers, in order. A query with no
/// answer left never completes.
type Script = HashMap<(Uuid, &'static str), VecDeque<Result<u32, EmailApiError>>>;

#[derive(Clone, Default)]
struct Counter {
    script: Arc<Mutex<Script>>,
    asked: Arc<Mutex<Vec<(SenderCountMailbox, String)>>>,
}

impl Counter {
    fn answers(
        self,
        link_id: Uuid,
        domain: &'static str,
        answers: impl IntoIterator<Item = Result<u32, EmailApiError>>,
    ) -> Self {
        self.script
            .lock()
            .unwrap()
            .insert((link_id, domain), answers.into_iter().collect());
        self
    }

    fn asked(&self) -> Vec<(SenderCountMailbox, String)> {
        self.asked.lock().unwrap().clone()
    }
}

impl SenderDomainCounter for Counter {
    async fn count(
        &self,
        mailbox: SenderCountMailbox,
        domain: &SenderDomain,
        _: DateTime<Utc>,
    ) -> Result<u32, EmailApiError> {
        self.asked
            .lock()
            .unwrap()
            .push((mailbox, domain.to_string()));
        let answer = self
            .script
            .lock()
            .unwrap()
            .iter_mut()
            .find(|((link_id, scripted), _)| {
                *link_id == mailbox.key.link_id && *scripted == domain.as_str()
            })
            .and_then(|(_, answers)| answers.pop_front());
        match answer {
            Some(answer) => answer,
            None => std::future::pending().await,
        }
    }
}

fn counts(result: Vec<SenderDomainCount>) -> Vec<(String, u32)> {
    result
        .into_iter()
        .map(|count| (count.domain.to_string(), count.message_count))
        .collect()
}

#[tokio::test(start_paused = true)]
async fn sums_each_domain_over_the_actors_own_active_inboxes() {
    let counter = Counter::default()
        .answers(GMAIL_LINK, "linear.app", [Ok(30)])
        .answers(OUTLOOK_LINK, "linear.app", [Ok(7)])
        .answers(GMAIL_LINK, "slack.com", [Ok(0)])
        .answers(OUTLOOK_LINK, "slack.com", [Ok(2)]);
    let service = SenderDomainCountService::new(Mailboxes, counter.clone());

    let result = service
        .count(&actor(), vec![domain("slack.com"), domain("linear.app")])
        .await
        .unwrap();

    assert_eq!(
        counts(result),
        [("slack.com".to_owned(), 2), ("linear.app".to_owned(), 37)]
    );
    let mut asked: Vec<Uuid> = counter
        .asked()
        .iter()
        .map(|(mailbox, _)| mailbox.key.link_id)
        .collect();
    asked.sort();
    asked.dedup();
    assert_eq!(asked, [GMAIL_LINK, OUTLOOK_LINK]);
    let outlook = counter
        .asked()
        .into_iter()
        .find(|(mailbox, _)| mailbox.key.link_id == OUTLOOK_LINK)
        .unwrap()
        .0;
    assert_eq!(
        outlook,
        SenderCountMailbox {
            key: key(OUTLOOK_LINK),
            provider: UserProvider::Outlook,
        }
    );
}

#[tokio::test(start_paused = true)]
async fn a_failed_query_counts_as_zero_without_failing_the_request() {
    let counter = Counter::default()
        .answers(GMAIL_LINK, "linear.app", [Ok(5)])
        .answers(
            OUTLOOK_LINK,
            "linear.app",
            [Err(EmailApiError::Transient {
                message: "Microsoft Graph returned HTTP 503".to_owned(),
            })],
        )
        .answers(
            GMAIL_LINK,
            "notion.so",
            [Err(EmailApiError::Permanent {
                message: "Gmail API returned 400".to_owned(),
            })],
        )
        .answers(OUTLOOK_LINK, "notion.so", [Ok(0)]);
    let service = SenderDomainCountService::new(Mailboxes, counter);

    let result = service
        .count(&actor(), vec![domain("linear.app"), domain("notion.so")])
        .await
        .unwrap();

    assert_eq!(
        counts(result),
        [("linear.app".to_owned(), 5), ("notion.so".to_owned(), 0)]
    );
}

#[tokio::test(start_paused = true)]
async fn queries_unanswered_at_the_deadline_count_as_zero() {
    // Outlook never answers for stripe.com.
    let counter = Counter::default()
        .answers(GMAIL_LINK, "stripe.com", [Ok(9)])
        .answers(GMAIL_LINK, "github.com", [Ok(4)])
        .answers(OUTLOOK_LINK, "github.com", [Ok(1)]);
    let service = SenderDomainCountService::new(Mailboxes, counter);
    let started = Instant::now();

    let result = service
        .count(&actor(), vec![domain("stripe.com"), domain("github.com")])
        .await
        .unwrap();

    assert_eq!(started.elapsed(), DEADLINE);
    assert_eq!(
        counts(result),
        [("stripe.com".to_owned(), 9), ("github.com".to_owned(), 5)]
    );
}

#[tokio::test(start_paused = true)]
async fn a_rate_limited_query_is_retried_after_the_delay_it_names() {
    let limited = || EmailApiError::RateLimited {
        retry_after: Some(Duration::from_secs(1)),
        origin: RateLimitOrigin::Local,
    };
    let counter = Counter::default()
        .answers(GMAIL_LINK, "figma.com", [Err(limited()), Ok(11)])
        .answers(OUTLOOK_LINK, "figma.com", [Ok(0)]);
    let service = SenderDomainCountService::new(Mailboxes, counter.clone());

    let result = service
        .count(&actor(), vec![domain("figma.com")])
        .await
        .unwrap();

    assert_eq!(counts(result), [("figma.com".to_owned(), 11)]);
    let gmail_queries = counter
        .asked()
        .iter()
        .filter(|(mailbox, _)| mailbox.key.link_id == GMAIL_LINK)
        .count();
    assert_eq!(gmail_queries, 2);
}

#[tokio::test(start_paused = true)]
async fn a_rate_limit_that_outlasts_the_deadline_counts_as_zero_at_once() {
    let counter = Counter::default()
        .answers(
            GMAIL_LINK,
            "figma.com",
            [Err(EmailApiError::RateLimited {
                retry_after: Some(Duration::from_secs(60)),
                origin: RateLimitOrigin::Provider { concurrency: false },
            })],
        )
        .answers(OUTLOOK_LINK, "figma.com", [Ok(3)]);
    let service = SenderDomainCountService::new(Mailboxes, counter);
    let started = Instant::now();

    let result = service
        .count(&actor(), vec![domain("figma.com")])
        .await
        .unwrap();

    assert!(started.elapsed() < DEADLINE);
    assert_eq!(counts(result), [("figma.com".to_owned(), 3)]);
}

#[tokio::test(start_paused = true)]
async fn a_mailbox_whose_credentials_fail_is_not_asked_again() {
    let counter = Counter::default()
        .answers(GMAIL_LINK, "a.com", [Err(EmailApiError::AuthRequired)])
        .answers(GMAIL_LINK, "b.com", [Ok(1)])
        .answers(GMAIL_LINK, "c.com", [Ok(1)])
        .answers(GMAIL_LINK, "d.com", [Ok(1)])
        .answers(GMAIL_LINK, "e.com", [Ok(1)])
        .answers(OUTLOOK_LINK, "a.com", [Ok(0)])
        .answers(OUTLOOK_LINK, "b.com", [Ok(0)])
        .answers(OUTLOOK_LINK, "c.com", [Ok(0)])
        .answers(OUTLOOK_LINK, "d.com", [Ok(0)])
        .answers(OUTLOOK_LINK, "e.com", [Ok(0)]);
    let service = SenderDomainCountService::new(Mailboxes, counter.clone());
    let started = Instant::now();

    let result = service
        .count(
            &actor(),
            ["a.com", "b.com", "c.com", "d.com", "e.com"]
                .into_iter()
                .map(domain)
                .collect(),
        )
        .await
        .unwrap();

    assert!(started.elapsed() < DEADLINE);
    // At most the queries already started with the failing one reach Gmail.
    let gmail_domains: Vec<String> = counter
        .asked()
        .into_iter()
        .filter(|(mailbox, _)| mailbox.key.link_id == GMAIL_LINK)
        .map(|(_, domain)| domain)
        .collect();
    assert!(gmail_domains.contains(&"a.com".to_owned()));
    assert!(!gmail_domains.contains(&"d.com".to_owned()));
    assert!(!gmail_domains.contains(&"e.com".to_owned()));
    let result = counts(result);
    assert_eq!(result[0], ("a.com".to_owned(), 0));
    assert_eq!(result[3], ("d.com".to_owned(), 0));
    assert_eq!(result[4], ("e.com".to_owned(), 0));
}

#[tokio::test(start_paused = true)]
async fn a_repeated_domain_is_asked_once_and_reported_for_each_request() {
    let counter = Counter::default()
        .answers(GMAIL_LINK, "linear.app", [Ok(4)])
        .answers(OUTLOOK_LINK, "linear.app", [Ok(1)]);
    let service = SenderDomainCountService::new(Mailboxes, counter.clone());

    let result = service
        .count(&actor(), vec![domain("linear.app"), domain("linear.app")])
        .await
        .unwrap();

    assert_eq!(
        counts(result),
        [("linear.app".to_owned(), 5), ("linear.app".to_owned(), 5)]
    );
    assert_eq!(counter.asked().len(), 2);
}

#[tokio::test(start_paused = true)]
async fn no_inboxes_reports_zeros_without_waiting() {
    let service = SenderDomainCountService::new(NoMailboxes, Counter::default());
    let started = Instant::now();

    let result = service
        .count(&actor(), vec![domain("linear.app")])
        .await
        .unwrap();

    assert_eq!(started.elapsed(), Duration::ZERO);
    assert_eq!(counts(result), [("linear.app".to_owned(), 0)]);
}

#[tokio::test(start_paused = true)]
async fn rejects_an_empty_or_oversized_domain_list() {
    let service = SenderDomainCountService::new(Mailboxes, Counter::default());

    assert!(matches!(
        service.count(&actor(), Vec::new()).await,
        Err(SenderDomainCountError::DomainCount)
    ));

    let too_many = (0..=MAX_SENDER_DOMAINS)
        .map(|index| domain(&format!("d{index}.com")))
        .collect();
    assert!(matches!(
        service.count(&actor(), too_many).await,
        Err(SenderDomainCountError::DomainCount)
    ));
}
