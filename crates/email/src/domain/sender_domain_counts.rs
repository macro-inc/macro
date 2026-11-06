//! How much recent mail the caller's own inboxes hold from each of a list of
//! sender domains, read live from the providers. Onboarding uses it to suggest
//! tools to connect before any mail has been synced.

use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use chrono::{DateTime, Utc};
use email_api_client::domain::models::{EmailApiError, SenderDomain};
use futures::StreamExt;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::link::{Link, UserProvider};
use tokio::sync::mpsc;
use tokio::time::Instant;
use tracing::{Instrument, Span};
use uuid::Uuid;

use super::mailbox::{MailboxError, MailboxKey};

#[cfg(test)]
mod test;

/// Most domains one request may ask about.
pub const MAX_SENDER_DOMAINS: usize = 40;
/// How far back mail counts.
const WINDOW: chrono::TimeDelta = chrono::TimeDelta::days(180);
/// How long a request waits for the providers. Queries still running then
/// count as zero.
const DEADLINE: Duration = Duration::from_secs(5);
/// Queries in flight per mailbox. Stays under both providers' request gates
/// (three for Graph, five for Gmail's live budget), leaving Gmail room for sync.
const QUERIES_PER_MAILBOX: usize = 3;
/// Wait before retrying a rate-limited query when the refusal names no delay.
const DEFAULT_RETRY_AFTER: Duration = Duration::from_secs(1);

/// One of the caller's inboxes, bound to its current credentials.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SenderCountMailbox {
    pub key: MailboxKey,
    pub provider: UserProvider,
}

/// Recent mail from one sender domain, summed over the caller's inboxes.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SenderDomainCount {
    #[cfg_attr(feature = "axum", schema(value_type = String, example = "linear.app"))]
    pub domain: SenderDomain,
    /// Messages received in the last 180 days. Gmail estimates it and Outlook
    /// counts at most 50 per inbox, so use it to rank, not as a total. A
    /// provider that failed or did not answer in time counts as zero.
    pub message_count: u32,
}

#[derive(Debug, thiserror::Error)]
pub enum SenderDomainCountError {
    #[error("between 1 and {MAX_SENDER_DOMAINS} sender domains are required")]
    DomainCount,
    #[error("the caller's inboxes could not be read")]
    Inboxes(#[source] MailboxError),
}

pub trait SenderDomainMailboxes: Send + Sync + 'static {
    /// Every inbox the actor can reach: their own and those delegated to them.
    fn accessible_inboxes(
        &self,
        actor: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<Link>, MailboxError>> + Send;
    /// The link's current credential binding, or `None` once it is gone.
    fn binding(
        &self,
        link_id: Uuid,
    ) -> impl Future<Output = Result<Option<MailboxKey>, MailboxError>> + Send;
}

/// Counts are ranking signals: an implementation may estimate or cap them.
pub trait SenderDomainCounter: Clone + Send + Sync + 'static {
    fn count(
        &self,
        mailbox: SenderCountMailbox,
        domain: &SenderDomain,
        since: DateTime<Utc>,
    ) -> impl Future<Output = Result<u32, EmailApiError>> + Send;
}

pub struct SenderDomainCountService<R, C> {
    repository: R,
    counter: C,
}

impl<R, C> SenderDomainCountService<R, C> {
    pub fn new(repository: R, counter: C) -> Self {
        Self {
            repository,
            counter,
        }
    }
}

/// What one mailbox answered for one domain; `None` when the query failed.
struct Answer {
    domain: SenderDomain,
    count: Option<u32>,
}

impl<R: SenderDomainMailboxes, C: SenderDomainCounter> SenderDomainCountService<R, C> {
    /// Counts recent mail from each domain across the actor's own active
    /// inboxes, one entry per requested domain in request order.
    ///
    /// Only provider failures are tolerated: each failed or unanswered query
    /// counts as zero. Queries still running at the deadline finish in the
    /// background, so their provider request permits are released normally.
    #[tracing::instrument(
        name = "email.sender_domain_counts",
        skip_all,
        fields(
            domain_count = span_count(domains.len()),
            link_count = tracing::field::Empty,
            timed_out_count = tracing::field::Empty,
            failed_count = tracing::field::Empty,
        ),
        err
    )]
    pub async fn count(
        &self,
        actor: &MacroUserIdStr<'_>,
        domains: Vec<SenderDomain>,
    ) -> Result<Vec<SenderDomainCount>, SenderDomainCountError> {
        let deadline = Instant::now() + DEADLINE;
        if domains.is_empty() || domains.len() > MAX_SENDER_DOMAINS {
            return Err(SenderDomainCountError::DomainCount);
        }

        // Duplicates are asked once; the request order is kept, so earlier
        // domains are asked first when the deadline is tight.
        let mut totals: HashMap<SenderDomain, u32> = HashMap::new();
        let mut unique = Vec::new();
        for domain in &domains {
            if totals.insert(domain.clone(), 0).is_none() {
                unique.push(domain.clone());
            }
        }
        let mailboxes = self
            .owned_mailboxes(actor)
            .await
            .map_err(SenderDomainCountError::Inboxes)?;
        let span = Span::current();
        span.record("link_count", span_count(mailboxes.len()));

        let since = Utc::now() - WINDOW;
        let (answers, mut received) = mpsc::unbounded_channel();
        for mailbox in &mailboxes {
            tokio::spawn(
                count_mailbox(
                    self.counter.clone(),
                    *mailbox,
                    unique.clone(),
                    since,
                    deadline,
                    answers.clone(),
                )
                .instrument(tracing::info_span!(
                    parent: &span,
                    "email.sender_domain_counts.mailbox",
                    link_id = %mailbox.key.link_id,
                    provider = ?mailbox.provider,
                )),
            );
        }
        drop(answers);

        let mut answered = 0usize;
        let mut failed = 0usize;
        while let Ok(Some(answer)) = tokio::time::timeout_at(deadline, received.recv()).await {
            answered += 1;
            match answer.count {
                Some(count) => {
                    if let Some(total) = totals.get_mut(&answer.domain) {
                        *total = total.saturating_add(count);
                    }
                }
                None => failed += 1,
            }
        }
        let asked = unique.len() * mailboxes.len();
        span.record(
            "timed_out_count",
            span_count(asked.saturating_sub(answered)),
        );
        span.record("failed_count", span_count(failed));

        Ok(domains
            .into_iter()
            .map(|domain| SenderDomainCount {
                message_count: totals.get(&domain).copied().unwrap_or_default(),
                domain,
            })
            .collect())
    }

    /// The actor's own active inboxes. Inboxes delegated to them belong to
    /// someone else and are left out.
    async fn owned_mailboxes(
        &self,
        actor: &MacroUserIdStr<'_>,
    ) -> Result<Vec<SenderCountMailbox>, MailboxError> {
        let mut mailboxes = Vec::new();
        for link in self.repository.accessible_inboxes(actor).await? {
            if link.macro_id.as_ref() != actor.as_ref() || !link.is_sync_active {
                continue;
            }

            if let Some(key) = self.repository.binding(link.id).await? {
                mailboxes.push(SenderCountMailbox {
                    key,
                    provider: link.provider,
                });
            }
        }

        Ok(mailboxes)
    }
}

/// Queries one mailbox for each domain, a few at a time, sending each answer
/// as it arrives. Starts nothing after the deadline, and stops querying a
/// mailbox whose credentials fail.
async fn count_mailbox<C: SenderDomainCounter>(
    counter: C,
    mailbox: SenderCountMailbox,
    domains: Vec<SenderDomain>,
    since: DateTime<Utc>,
    deadline: Instant,
    answers: mpsc::UnboundedSender<Answer>,
) {
    let credentials_failed = AtomicBool::new(false);
    futures::stream::iter(domains)
        .for_each_concurrent(QUERIES_PER_MAILBOX, |domain| {
            let counter = &counter;
            let answers = &answers;
            let credentials_failed = &credentials_failed;
            async move {
                if Instant::now() >= deadline {
                    return;
                }

                let count = if credentials_failed.load(Ordering::Relaxed) {
                    None
                } else {
                    count_with_retries(counter, mailbox, &domain, since, deadline)
                        .await
                        .inspect_err(|error| {
                            if is_credential_failure(error) {
                                credentials_failed.store(true, Ordering::Relaxed);
                            }

                            tracing::warn!(
                                link_id = %mailbox.key.link_id,
                                provider = ?mailbox.provider,
                                domain = %domain,
                                error = %error,
                                "sender domain count failed; counting it as zero"
                            );
                        })
                        .ok()
                };
                // The request may have stopped waiting; a late answer is dropped.
                let _ = answers.send(Answer { domain, count });
            }
        })
        .await;
}

/// Retries a rate-limited query after the delay it names, while that still
/// lands before the deadline.
async fn count_with_retries<C: SenderDomainCounter>(
    counter: &C,
    mailbox: SenderCountMailbox,
    domain: &SenderDomain,
    since: DateTime<Utc>,
    deadline: Instant,
) -> Result<u32, EmailApiError> {
    loop {
        match counter.count(mailbox, domain, since).await {
            Err(EmailApiError::RateLimited {
                retry_after,
                origin,
            }) => {
                // The provider sets Retry-After; an unrepresentable instant is past the deadline.
                let Some(retry_at) = Instant::now()
                    .checked_add(retry_after.unwrap_or(DEFAULT_RETRY_AFTER))
                    .filter(|at| *at < deadline)
                else {
                    return Err(EmailApiError::RateLimited {
                        retry_after,
                        origin,
                    });
                };

                tokio::time::sleep_until(retry_at).await;
            }
            result => return result,
        }
    }
}

/// Span numbers are `i64`: OpenTelemetry receives unsigned fields as strings.
fn span_count(count: usize) -> i64 {
    i64::try_from(count).unwrap_or(i64::MAX)
}

fn is_credential_failure(error: &EmailApiError) -> bool {
    matches!(
        error,
        EmailApiError::AuthRequired
            | EmailApiError::Forbidden
            | EmailApiError::CredentialsUnavailable { .. }
    )
}
