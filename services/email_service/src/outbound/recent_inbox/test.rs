use std::cell::Cell;

use email_api_client::domain::models::{MessageWithCalendarParts, RateLimitOrigin};
use email_api_client::domain::ports::AlwaysAllowRateLimiter;
use serde_json::json;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path, query_param, query_param_is_missing},
};

use super::*;
use crate::outbound::email_api::StaticTokenSource;

#[tokio::test]
async fn gmail_lists_sent_mail_with_the_same_window_filter_as_inbox() {
    let live = MockServer::start().await;
    let window = MockServer::start().await;
    let gmail = |server: &MockServer| {
        EmailApiClientServiceImpl::new(
            GmailApiClientRepository::new(gmail_client::GmailClient::new_with_urls(
                None,
                server.uri(),
                server.uri(),
                server.uri(),
                "test".to_owned(),
            )),
            StaticTokenSource::new("token"),
            AlwaysAllowRateLimiter,
        )
    };
    let gmail_live = gmail(&live);
    let gmail_window = gmail(&window);
    Mock::given(method("GET"))
        .and(path("/users/me/messages"))
        .and(query_param("labelIds", "INBOX"))
        .and(query_param("maxResults", "10"))
        .and(query_param_is_missing("q"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"messages": []})))
        .expect(1)
        .mount(&live)
        .await;

    let since: chrono::DateTime<chrono::Utc> = "2026-10-21T09:30:00Z".parse().unwrap();
    for (folder, label) in [
        (RecentMailFolder::Inbox, "INBOX"),
        (RecentMailFolder::Sent, "SENT"),
    ] {
        Mock::given(method("GET"))
            .and(path("/users/me/messages"))
            .and(query_param("labelIds", label))
            .and(query_param("maxResults", "500"))
            .and(query_param("q", format!("after:{}", since.timestamp() - 1)))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"messages": []})))
            .expect(1)
            .mount(&window)
            .await;

        gmail_recent_messages(
            &gmail_live,
            &gmail_window,
            Uuid::now_v7(),
            RecentRead {
                folder,
                limit: 500,
                since: Some(since),
            },
        )
        .await
        .unwrap();
    }

    gmail_recent_messages(
        &gmail_live,
        &gmail_window,
        Uuid::now_v7(),
        RecentRead {
            folder: RecentMailFolder::Inbox,
            limit: 10,
            since: None,
        },
    )
    .await
    .unwrap();
}

type Read = std::future::Ready<Result<Option<MessageWithCalendarParts>, EmailApiError>>;

/// A read refused `refusals` times, each asking for `retry_after` seconds,
/// then answered; it counts its tries.
fn read(tries: &Cell<u32>, refusals: u32, retry_after: Option<u64>) -> impl FnMut() -> Read + '_ {
    move || {
        tries.set(tries.get() + 1);
        std::future::ready(if tries.get() <= refusals {
            Err(EmailApiError::RateLimited {
                retry_after: retry_after.map(Duration::from_secs),
                origin: RateLimitOrigin::Local,
            })
        } else {
            Ok(None)
        })
    }
}

#[tokio::test(start_paused = true)]
async fn a_window_read_waits_out_refusals_until_its_deadline() {
    let tries = Cell::new(0);
    let started = Instant::now();

    let answer =
        wait_out_refusals(Some(started + GMAIL_WINDOW_WAIT), read(&tries, 3, Some(10))).await;

    assert!(matches!(answer, Ok(None)));
    assert_eq!(tries.get(), 4);
    assert_eq!(started.elapsed(), Duration::from_secs(30));
}

#[tokio::test(start_paused = true)]
async fn a_refusal_without_a_wait_retries_after_a_second() {
    let tries = Cell::new(0);
    let started = Instant::now();

    let answer = wait_out_refusals(Some(started + GMAIL_WINDOW_WAIT), read(&tries, 2, None)).await;

    assert!(matches!(answer, Ok(None)));
    assert_eq!(started.elapsed(), GMAIL_REFUSED_RETRY * 2);
}

#[tokio::test(start_paused = true)]
async fn a_wait_past_the_deadline_is_the_answer() {
    let tries = Cell::new(0);
    let started = Instant::now();

    // Four waits of 10 s fit in 45; the fifth would not.
    let answer = wait_out_refusals(
        Some(started + GMAIL_WINDOW_WAIT),
        read(&tries, 10, Some(10)),
    )
    .await;

    assert!(matches!(
        answer,
        Err(EmailApiError::RateLimited {
            retry_after: Some(wait),
            ..
        }) if wait == Duration::from_secs(10)
    ));
    assert_eq!(tries.get(), 5);
    assert_eq!(started.elapsed(), Duration::from_secs(40));
}

#[tokio::test(start_paused = true)]
async fn a_read_not_started_by_its_deadline_is_left_out_untried() {
    let tries = Cell::new(0);
    let started = Instant::now();

    let answer = wait_out_refusals(Some(started), read(&tries, 0, None)).await;

    assert!(matches!(
        answer,
        Err(EmailApiError::RateLimited {
            retry_after: None,
            origin: RateLimitOrigin::Local
        })
    ));
    assert_eq!(tries.get(), 0);
}

#[tokio::test(start_paused = true)]
async fn a_read_running_at_its_deadline_finishes_and_none_starts_after() {
    let tries = Cell::new(0);
    let started = Instant::now();
    // Each try takes 30 s; the first `answered_on` - 1 are refused, asking
    // for a second.
    let slow = |answered_on: u32| {
        let tries = &tries;
        move || {
            tries.set(tries.get() + 1);
            let refused = tries.get() < answered_on;
            async move {
                tokio::time::sleep(Duration::from_secs(30)).await;
                if refused {
                    Err(EmailApiError::RateLimited {
                        retry_after: Some(Duration::from_secs(1)),
                        origin: RateLimitOrigin::Local,
                    })
                } else {
                    Ok(None::<MessageWithCalendarParts>)
                }
            }
        }
    };

    // The second try starts at 31 s and runs past the deadline: it finishes.
    let answer = wait_out_refusals(Some(started + GMAIL_WINDOW_WAIT), slow(2)).await;
    assert!(matches!(answer, Ok(None)));
    assert_eq!(tries.get(), 2);
    assert_eq!(started.elapsed(), Duration::from_secs(61));

    // Refused past the deadline, it is the answer: no third try starts.
    tries.set(0);
    let started = Instant::now();
    let answer = wait_out_refusals(Some(started + GMAIL_WINDOW_WAIT), slow(3)).await;
    assert!(matches!(
        answer,
        Err(EmailApiError::RateLimited { retry_after: Some(wait), .. }) if wait == Duration::from_secs(1)
    ));
    assert_eq!(tries.get(), 2);
    assert_eq!(started.elapsed(), Duration::from_secs(61));
}

#[tokio::test(start_paused = true)]
async fn a_wait_that_reaches_the_deadline_is_the_answer() {
    let tries = Cell::new(0);
    let started = Instant::now();

    // A wait of the whole window would wake with nothing left to try in.
    let answer = wait_out_refusals(
        Some(started + GMAIL_WINDOW_WAIT),
        read(&tries, 1, Some(GMAIL_WINDOW_WAIT.as_secs())),
    )
    .await;

    assert!(matches!(answer, Err(EmailApiError::RateLimited { .. })));
    assert_eq!(tries.get(), 1);
    assert_eq!(started.elapsed(), Duration::ZERO);
}

#[tokio::test(start_paused = true)]
async fn an_oversized_wait_is_the_answer() {
    let tries = Cell::new(0);
    let started = Instant::now();

    let answer = wait_out_refusals(
        Some(started + GMAIL_WINDOW_WAIT),
        read(&tries, 1, Some(u64::MAX)),
    )
    .await;

    assert!(matches!(answer, Err(EmailApiError::RateLimited { .. })));
    assert_eq!(tries.get(), 1);
    assert_eq!(started.elapsed(), Duration::ZERO);
}

#[tokio::test(start_paused = true)]
async fn the_newest_few_are_refused_at_once() {
    let tries = Cell::new(0);
    let started = Instant::now();

    let answer = wait_out_refusals(None, read(&tries, 1, Some(1))).await;

    assert!(matches!(answer, Err(EmailApiError::RateLimited { .. })));
    assert_eq!(tries.get(), 1);
    assert_eq!(started.elapsed(), Duration::ZERO);
}

#[test]
fn an_outlook_sent_window_dates_mail_by_when_it_was_sent() {
    let arrived = "2026-11-02T09:00:05Z".parse().ok();
    let sent = "2026-11-02T09:00:00Z".parse().ok();
    assert_eq!(window_date(arrived, sent, true), sent);
    assert_eq!(window_date(arrived, sent, false), arrived);
    // Each falls back on the other date when its own is missing.
    assert_eq!(window_date(arrived, None, true), arrived);
    assert_eq!(window_date(None, sent, false), sent);
}

#[tokio::test]
async fn unsupported_imap_context_never_calls_the_provider() {
    let server = MockServer::start().await;
    let db = sqlx::PgPool::connect_lazy("postgres://unused@127.0.0.1:1/unused").unwrap();
    db.close().await;
    let gateway = super::super::email_api::imap::ImapMailboxGateway {
        client: imap_service_client::ImapServiceClient::new(
            server.uri(),
            "internal-test-key".into(),
        )
        .unwrap(),
        health: email::outbound::mailbox_pg::PgMailboxSync::new(db)
            .with_provider(email::domain::models::UserProvider::Imap),
    };
    let mailbox = MailboxKey {
        link_id: Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    for read in [
        RecentRead {
            folder: RecentMailFolder::Sent,
            limit: 10,
            since: None,
        },
        RecentRead {
            folder: RecentMailFolder::Inbox,
            limit: 10,
            since: Some("2026-11-01T00:00:00Z".parse().unwrap()),
        },
        RecentRead {
            folder: RecentMailFolder::Inbox,
            limit: 101,
            since: None,
        },
    ] {
        assert!(matches!(
            imap_recent_messages(&gateway, mailbox, read).await,
            Err(RecentInboxReadError::Unsupported)
        ));
    }
    assert!(server.received_requests().await.unwrap().is_empty());
    assert_eq!(
        imap_recent_limit(RecentRead {
            folder: RecentMailFolder::Inbox,
            limit: 100,
            since: None
        })
        .unwrap(),
        100
    );
}
