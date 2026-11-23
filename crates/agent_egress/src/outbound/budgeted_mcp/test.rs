use super::*;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::time::Instant;

fn policy() -> BudgetPolicy {
    BudgetPolicy {
        concurrency: 4,
        interval: Duration::from_millis(100),
        deadline: Duration::from_secs(5),
        default_retry_after: Duration::from_secs(1),
        max_jitter: Duration::from_millis(250),
    }
}

fn lane(account: &str) -> BudgetLane {
    BudgetLane::of(
        MacroUserIdStr::try_from_email(account).unwrap(),
        &UpstreamCall::bearer(
            url::Url::parse("https://api.githubcopilot.com/mcp/").unwrap(),
            crate::domain::model::BearerToken::new("test-credential"),
        )
        .unwrap(),
    )
}

/// A fake upstream: records when each attempt started and how many were
/// in flight at once, answers after `latency`, and refuses the first
/// `refusals` attempts with HTTP 429.
struct Upstream {
    latency: Duration,
    refusals: usize,
    retry_after: Option<Duration>,
    attempts: AtomicUsize,
    in_flight: AtomicUsize,
    most_in_flight: AtomicUsize,
    starts: Mutex<Vec<Instant>>,
}

impl Upstream {
    fn new(latency: Duration, refusals: usize, retry_after: Option<Duration>) -> Self {
        Self {
            latency,
            refusals,
            retry_after,
            attempts: AtomicUsize::new(0),
            in_flight: AtomicUsize::new(0),
            most_in_flight: AtomicUsize::new(0),
            starts: Mutex::new(Vec::new()),
        }
    }

    async fn call(&self) -> Result<usize, EgressError> {
        let attempt = self.attempts.fetch_add(1, Ordering::SeqCst);
        self.starts.lock().unwrap().push(Instant::now());
        let now = self.in_flight.fetch_add(1, Ordering::SeqCst) + 1;
        self.most_in_flight.fetch_max(now, Ordering::SeqCst);
        tokio::time::sleep(self.latency).await;
        self.in_flight.fetch_sub(1, Ordering::SeqCst);
        if attempt < self.refusals {
            Err(EgressError::RateLimited {
                retry_after: self.retry_after,
            })
        } else {
            Ok(attempt)
        }
    }
}

#[tokio::test(start_paused = true)]
async fn a_burst_on_one_account_and_app_is_bounded_and_paced() {
    let budget = CallBudget::new(policy());
    let upstream = Upstream::new(Duration::from_millis(500), 0, None);

    let results = futures::future::join_all(
        (0..20).map(|_| budget.run(lane("owner@example.com"), || upstream.call())),
    )
    .await;

    assert!(results.iter().all(Result::is_ok));
    assert_eq!(upstream.attempts.load(Ordering::SeqCst), 20);
    assert!(
        upstream.most_in_flight.load(Ordering::SeqCst) <= 4,
        "at most 4 calls in flight, saw {}",
        upstream.most_in_flight.load(Ordering::SeqCst)
    );
    let mut starts = upstream.starts.lock().unwrap().clone();
    starts.sort();
    for pair in starts.windows(2) {
        assert!(
            pair[1] - pair[0] >= Duration::from_millis(100),
            "calls start at least 100ms apart, saw {:?}",
            pair[1] - pair[0]
        );
    }
}

#[tokio::test(start_paused = true)]
async fn another_account_is_not_queued_behind_a_busy_one() {
    let budget = CallBudget::new(policy());
    let busy = Upstream::new(Duration::from_secs(2), 0, None);
    let other = Upstream::new(Duration::from_millis(10), 0, None);
    let start = Instant::now();

    let (_, other_result) = tokio::join!(
        futures::future::join_all(
            (0..8).map(|_| budget.run(lane("owner@example.com"), || busy.call()))
        ),
        async {
            tokio::time::sleep(Duration::from_millis(1)).await;
            budget.run(lane("other@example.com"), || other.call()).await
        },
    );

    assert!(other_result.is_ok());
    assert!(other.starts.lock().unwrap()[0] - start < Duration::from_millis(50));
}

#[tokio::test(start_paused = true)]
async fn a_429_cools_the_whole_lane_down_for_retry_after_and_the_call_is_retried() {
    let budget = CallBudget::new(policy());
    let upstream = Upstream::new(Duration::from_millis(10), 1, Some(Duration::from_secs(2)));
    let start = Instant::now();

    let (first, second) = tokio::join!(
        budget.run(lane("owner@example.com"), || upstream.call()),
        async {
            // Reserves the next slot before the first call's 429 lands, so it
            // finds the cooldown only once it wakes for that slot.
            tokio::time::sleep(Duration::from_millis(1)).await;
            budget
                .run(lane("owner@example.com"), || upstream.call())
                .await
        },
    );

    assert!(first.is_ok(), "the refused call is retried: {first:?}");
    assert!(second.is_ok());
    assert_eq!(upstream.attempts.load(Ordering::SeqCst), 3);
    let starts = upstream.starts.lock().unwrap().clone();
    assert!(
        starts[1..]
            .iter()
            .all(|at| *at - start >= Duration::from_secs(2)),
        "every call after the 429 waits out Retry-After: {:?}",
        starts.iter().map(|at| *at - start).collect::<Vec<_>>()
    );
}

#[tokio::test(start_paused = true)]
async fn a_call_still_refused_at_its_deadline_fails_as_rate_limited() {
    let budget = CallBudget::new(policy());
    let upstream = Upstream::new(
        Duration::from_millis(10),
        usize::MAX,
        Some(Duration::from_secs(1)),
    );
    let start = Instant::now();

    let result = budget
        .run(lane("owner@example.com"), || upstream.call())
        .await;

    assert!(
        matches!(result, Err(EgressError::RateLimited { .. })),
        "{result:?}"
    );
    let attempts = upstream.attempts.load(Ordering::SeqCst);
    assert!(
        (2..=5).contains(&attempts),
        "retried within the 5s deadline, made {attempts} attempts"
    );
    assert!(
        start.elapsed() <= Duration::from_secs(5) + upstream.latency,
        "no attempt starts after the deadline"
    );
}

#[tokio::test(start_paused = true)]
async fn a_429_without_retry_after_waits_the_default() {
    let budget = CallBudget::new(policy());
    let upstream = Upstream::new(Duration::from_millis(10), 1, None);
    let start = Instant::now();

    let result = budget
        .run(lane("owner@example.com"), || upstream.call())
        .await;

    assert!(result.is_ok());
    assert!(upstream.starts.lock().unwrap()[1] - start >= Duration::from_secs(1));
}

#[async_trait::async_trait]
impl ActorMcpTransport for Upstream {
    async fn exchange(
        &self,
        _: AgentSessionId,
        _: MacroUserIdStr<'static>,
        _: UpstreamCall,
        _: Value,
    ) -> Result<Value, EgressError> {
        self.call()
            .await
            .map(|attempt| serde_json::json!({"attempt": attempt}))
    }
}

#[tokio::test(start_paused = true)]
async fn the_transport_retries_an_exchange_the_upstream_refused() {
    let upstream = Arc::new(Upstream::new(
        Duration::from_millis(10),
        1,
        Some(Duration::from_secs(1)),
    ));
    let transport = BudgetedMcpTransport::new(upstream.clone(), policy());

    let result = transport
        .exchange(
            AgentSessionId::new(),
            MacroUserIdStr::try_from_email("owner@example.com").unwrap(),
            UpstreamCall::bearer(
                url::Url::parse("https://api.githubcopilot.com/mcp/").unwrap(),
                crate::domain::model::BearerToken::new("test-credential"),
            )
            .unwrap(),
            serde_json::json!({"method": "tools/call", "params": {"name": "search"}}),
        )
        .await
        .unwrap();

    assert_eq!(result["attempt"], 1);
    assert_eq!(upstream.attempts.load(Ordering::SeqCst), 2);
}

#[tokio::test(start_paused = true)]
async fn a_listing_is_not_budgeted() {
    let upstream = Arc::new(Upstream::new(
        Duration::from_millis(10),
        usize::MAX,
        Some(Duration::from_secs(1)),
    ));
    let transport = BudgetedMcpTransport::new(upstream.clone(), policy());

    let result = transport
        .exchange(
            AgentSessionId::new(),
            MacroUserIdStr::try_from_email("owner@example.com").unwrap(),
            UpstreamCall::bearer(
                url::Url::parse("https://api.githubcopilot.com/mcp/").unwrap(),
                crate::domain::model::BearerToken::new("test-credential"),
            )
            .unwrap(),
            serde_json::json!({"method": "tools/list"}),
        )
        .await;

    assert!(matches!(result, Err(EgressError::RateLimited { .. })));
    assert_eq!(
        upstream.attempts.load(Ordering::SeqCst),
        1,
        "a listing is sent once, never retried or queued"
    );
}

#[tokio::test(start_paused = true)]
async fn an_enormous_retry_after_fails_the_call_instead_of_panicking() {
    let budget = CallBudget::new(policy());
    let upstream = Upstream::new(
        Duration::from_millis(10),
        usize::MAX,
        Some(Duration::from_secs(u64::MAX)),
    );

    let result = budget
        .run(lane("owner@example.com"), || upstream.call())
        .await;

    assert!(
        matches!(
            result,
            Err(EgressError::RateLimited {
                retry_after: Some(_)
            })
        ),
        "{result:?}"
    );
    assert_eq!(upstream.attempts.load(Ordering::SeqCst), 1);
}
