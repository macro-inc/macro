use super::*;
use std::sync::{Arc, Mutex};

const OWN: Uuid = Uuid::from_u128(1);
const SHARED: Uuid = Uuid::from_u128(2);

#[derive(Debug, thiserror::Error)]
#[error("test persistence failure")]
struct TestError;

#[derive(Clone, Debug, PartialEq, Eq)]
enum Call {
    Scheduled(Uuid, u32, u32),
}

#[derive(Clone, Default)]
struct Fake {
    fail: Option<&'static str>,
    calls: Arc<Mutex<Vec<Call>>>,
}

impl ScheduledDraftRepository for Fake {
    type Err = TestError;
    async fn scheduled(
        &self,
        id: Uuid,
        offset: u32,
        limit: u32,
    ) -> Result<Vec<Message>, TestError> {
        self.calls
            .lock()
            .unwrap()
            .push(Call::Scheduled(id, offset, limit));
        if self.fail == Some("scheduled") {
            return Err(TestError);
        }
        Ok(Vec::new())
    }
}

fn service(fake: Fake) -> ScheduledDraftService<Fake> {
    ScheduledDraftService { repository: fake }
}

#[tokio::test]
async fn scheduled_rejects_out_of_bounds_limits_before_reading() {
    let fake = Fake::default();
    assert!(matches!(
        service(fake.clone()).list(OWN, 0, 0).await,
        Err(ScheduledDraftError::NonPositiveLimit)
    ));
    assert!(fake.calls.lock().unwrap().is_empty());
    for limit in [MAX_SCHEDULED_LIMIT + 1, u32::MAX] {
        let fake = Fake::default();
        assert!(matches!(
            service(fake.clone()).list(OWN, 0, limit).await,
            Err(ScheduledDraftError::ExcessiveLimit(MAX_SCHEDULED_LIMIT))
        ));
        assert!(fake.calls.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn scheduled_passes_exact_bounds_offsets_and_selected_inbox() {
    for limit in [1, DEFAULT_SCHEDULED_LIMIT, MAX_SCHEDULED_LIMIT] {
        for offset in [0, u32::MAX] {
            let fake = Fake::default();
            assert!(
                service(fake.clone())
                    .list(SHARED, offset, limit)
                    .await
                    .unwrap()
                    .is_empty()
            );
            assert_eq!(
                *fake.calls.lock().unwrap(),
                vec![Call::Scheduled(SHARED, offset, limit)]
            );
        }
    }
}

#[tokio::test]
async fn scheduled_retains_query_failures() {
    let fake = Fake {
        fail: Some("scheduled"),
        ..Default::default()
    };
    assert!(matches!(
        service(fake).list(OWN, 0, 100).await,
        Err(ScheduledDraftError::Query(TestError))
    ));
}

#[derive(Default)]
struct PageQueries {
    calls: Mutex<Vec<&'static str>>,
    fail: Option<&'static str>,
}
impl ScheduledDraftQueries for PageQueries {
    type Stored = u32;
    async fn scheduled_rows(
        &self,
        link: Uuid,
        offset: u32,
        limit: u32,
    ) -> anyhow::Result<Vec<u32>> {
        assert_eq!((link, offset, limit), (SHARED, 7, 1001));
        self.calls.lock().unwrap().push("page");
        anyhow::ensure!(self.fail != Some("page"), "page failed");
        Ok(vec![3, 1, 2])
    }
    async fn expand_rows(&self, rows: Vec<u32>) -> anyhow::Result<Vec<Message>> {
        assert_eq!(rows, [3, 1, 2]);
        self.calls.lock().unwrap().push("expand");
        anyhow::ensure!(self.fail != Some("expand"), "expand failed");
        Ok(vec![])
    }
}
#[tokio::test]
async fn stored_page_rejects_zero_before_queries_and_preserves_the_unbounded_internal_limit() {
    let queries = PageQueries::default();
    assert_eq!(
        get_scheduled_messages_by_link_id(&queries, SHARED, 7, 0)
            .await
            .unwrap_err()
            .to_string(),
        "limit must be positive"
    );
    assert!(queries.calls.lock().unwrap().is_empty());
    assert!(
        get_scheduled_messages_by_link_id(&queries, SHARED, 7, 1001)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(*queries.calls.lock().unwrap(), ["page", "expand"]);
}
#[tokio::test]
async fn stored_page_preserves_read_and_expansion_errors() {
    for fail in ["page", "expand"] {
        let queries = PageQueries {
            fail: Some(fail),
            ..Default::default()
        };
        assert_eq!(
            get_scheduled_messages_by_link_id(&queries, SHARED, 7, 1001)
                .await
                .unwrap_err()
                .to_string(),
            format!("{fail} failed")
        );
        assert_eq!(queries.calls.lock().unwrap().last(), Some(&fail));
    }
}
