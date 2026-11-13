//! Stream lifecycle: replay and cursors, the flag, lagging, revocation,
//! coalescing and limits.

use crate::domain::models::{
    ControlEvent, Cursor, LogRecord, PrincipalKind, PublicLogEvent, StreamItem, StreamPrincipal,
    WebhookScope,
};
use crate::domain::ports::TailItem;
use crate::domain::registry::STREAM_BUFFER;
use crate::domain::stream::{COALESCE_WINDOW, REVALIDATE_INTERVAL, StreamError};
use crate::domain::test_support::*;
use event_exposure::{EntityType, Stage};
use std::sync::atomic::Ordering;

fn doc_event(name: &str) -> LogRecord {
    public(
        event(name, "document", DOC),
        entity(EntityType::Document, DOC),
    )
}

fn preview_event(name: &str) -> LogRecord {
    LogRecord {
        event: Some(PublicLogEvent {
            event: event(name, "document", DOC),
            audience: entity(EntityType::Document, DOC),
            stage: Stage::Preview,
        }),
        invalidations: Vec::new(),
    }
}

/// A harness whose `reader` can read `DOC` and has the flag.
fn flagged() -> (Harness, macro_user_id::user_id::MacroUserIdStr<'static>) {
    let harness = Harness::default();
    let reader = user("reader@example.com");
    harness
        .access
        .grant(EntityType::Document, DOC, reader.as_ref());
    harness.preview.enable(&reader);
    (harness, reader)
}

async fn next_id(stream: &mut Opened) -> Option<String> {
    match stream.next_now().await? {
        StreamItem::Event { id, .. } => Some(id),
        StreamItem::Control(control) => Some(format!("control:{}", control.name())),
    }
}

#[tokio::test(start_paused = true)]
async fn a_resumed_stream_replays_after_its_cursor_then_continues_live_without_duplicates() {
    let (harness, reader) = flagged();
    let first = harness.publish(doc_event("document.created")).await;
    let second = harness.publish(doc_event("document.updated")).await;
    let third = harness.publish(doc_event("document.deleted")).await;

    let mut stream = harness
        .open(
            person(&reader),
            WebhookScope::User,
            filter(&["document.*"]),
            Some(first.to_string()),
        )
        .await
        .unwrap();
    let live = harness.publish(doc_event("document.copied")).await;

    assert_eq!(next_id(&mut stream).await, Some(second.to_string()));
    assert_eq!(next_id(&mut stream).await, Some(third.to_string()));
    assert_eq!(next_id(&mut stream).await, Some(live.to_string()));
    assert_eq!(next_id(&mut stream).await, None);
}

#[tokio::test(start_paused = true)]
async fn replay_resolves_access_at_replay_time() {
    let (harness, reader) = flagged();
    let start = harness.publish(doc_event("document.created")).await;
    harness.publish(doc_event("document.updated")).await;
    harness
        .access
        .revoke(EntityType::Document, DOC, reader.as_ref());

    let mut stream = harness
        .open(
            person(&reader),
            WebhookScope::User,
            filter(&["document.updated"]),
            Some(start.to_string()),
        )
        .await
        .unwrap();

    assert_eq!(next_id(&mut stream).await, None);
}

#[tokio::test(start_paused = true)]
async fn a_cursor_older_than_the_window_is_refused() {
    let (harness, reader) = flagged();
    *harness.log.floor.lock().unwrap() = Cursor { ms: 5_000, seq: 0 };

    let opened = harness
        .open(
            person(&reader),
            WebhookScope::User,
            filter(&["document.updated"]),
            Some("4999-0".to_owned()),
        )
        .await;

    assert!(matches!(opened, Err(StreamError::CursorExpired)));
}

#[tokio::test(start_paused = true)]
async fn a_malformed_cursor_is_a_bad_request() {
    let (harness, reader) = flagged();

    let opened = harness
        .open(
            person(&reader),
            WebhookScope::User,
            filter(&["document.updated"]),
            Some("not-a-cursor".to_owned()),
        )
        .await;

    assert!(matches!(opened, Err(StreamError::BadRequest(_))));
}

#[tokio::test(start_paused = true)]
async fn a_tail_gap_resets_every_stream() {
    let (harness, reader) = flagged();
    let mut stream = harness
        .open(
            person(&reader),
            WebhookScope::User,
            filter(&["document.updated"]),
            None,
        )
        .await
        .unwrap();

    struct GapThenNothing(bool);
    impl crate::domain::ports::LogTail for GapThenNothing {
        async fn next(&mut self) -> Result<TailItem, rootcause::Report> {
            if std::mem::replace(&mut self.0, false) {
                return Ok(TailItem::Gap);
            }
            std::future::pending().await
        }
    }
    let shutdown = tokio_util::sync::CancellationToken::new();
    let fan_out = harness.fan_out.clone();
    let tail = tokio::spawn({
        let shutdown = shutdown.clone();
        async move { fan_out.run(GapThenNothing(true), shutdown).await }
    });

    assert_eq!(next_id(&mut stream).await.as_deref(), Some("control:reset"));
    shutdown.cancel();
    tail.await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn a_stream_that_falls_behind_is_closed_with_its_cursor() {
    let (harness, reader) = flagged();
    let mut stream = harness
        .open(
            person(&reader),
            WebhookScope::User,
            filter(&["document.updated"]),
            None,
        )
        .await
        .unwrap();
    let first = harness.publish(doc_event("document.updated")).await;
    assert_eq!(next_id(&mut stream).await, Some(first.to_string()));

    // The client stops reading: the transport and the stream's buffer fill.
    for _ in 0..(STREAM_BUFFER + 64) {
        harness.publish(doc_event("document.updated")).await;
    }

    let mut last_event = first;
    let control = loop {
        match stream.next_now().await {
            Some(StreamItem::Event { id, .. }) => last_event = id.parse().unwrap(),
            Some(StreamItem::Control(control)) => break control,
            None => panic!("the stream ended without a control event"),
        }
    };
    assert_eq!(
        control,
        ControlEvent::Lagged {
            cursor: Some(last_event.to_string())
        }
    );
    assert_eq!(stream.next_now().await.map(|_| ()), None);
}

#[tokio::test(start_paused = true)]
async fn a_revoked_credential_closes_the_stream_at_the_next_check() {
    let (harness, reader) = flagged();
    let mut stream = harness
        .open(
            person(&reader),
            WebhookScope::User,
            filter(&["document.updated"]),
            None,
        )
        .await
        .unwrap();

    stream.valid.store(false, Ordering::SeqCst);
    tokio::time::sleep(REVALIDATE_INTERVAL).await;

    assert_eq!(
        next_id(&mut stream).await.as_deref(),
        Some("control:revoked")
    );
}

#[tokio::test(start_paused = true)]
async fn high_frequency_events_are_coalesced_per_entity_latest_wins() {
    let (harness, reader) = flagged();
    let mut stream = harness
        .open(
            person(&reader),
            WebhookScope::User,
            filter(&["document.interaction"]),
            None,
        )
        .await
        .unwrap();

    let first = harness.publish(doc_event("document.interaction")).await;
    harness.publish(doc_event("document.interaction")).await;
    let latest = harness.publish(doc_event("document.interaction")).await;

    assert_eq!(next_id(&mut stream).await, Some(first.to_string()));
    assert_eq!(next_id(&mut stream).await, None, "held for the window");
    tokio::time::sleep(COALESCE_WINDOW).await;
    assert_eq!(next_id(&mut stream).await, Some(latest.to_string()));
    assert_eq!(next_id(&mut stream).await, None);
}

#[tokio::test(start_paused = true)]
async fn an_api_key_holds_at_most_five_streams() {
    let harness = Harness::default();
    let holder = user("holder@example.com");
    harness.preview.enable(&holder);
    let key = StreamPrincipal {
        kind: PrincipalKind::User {
            user: holder,
            api_key: true,
        },
        credential_id: "key-digest".to_owned(),
    };
    let mut open = Vec::new();
    for _ in 0..5 {
        open.push(
            harness
                .open(
                    key.clone(),
                    WebhookScope::User,
                    filter(&["document.updated"]),
                    None,
                )
                .await
                .unwrap(),
        );
    }

    let sixth = harness
        .open(
            key.clone(),
            WebhookScope::User,
            filter(&["document.updated"]),
            None,
        )
        .await;
    assert!(matches!(sixth, Err(StreamError::TooManyStreams)));

    // Closing one frees its lease once its task has run; with the clock
    // paused, this sleep returns only after every task is idle.
    drop(open.pop());
    tokio::time::sleep(std::time::Duration::from_millis(1)).await;
    assert!(
        harness
            .open(key, WebhookScope::User, filter(&["document.updated"]), None)
            .await
            .is_ok()
    );
}

#[tokio::test(start_paused = true)]
async fn without_the_flag_a_stream_behaves_as_before() {
    let harness = Harness::default();
    let reader = user("reader@example.com");
    harness
        .access
        .grant(EntityType::Document, DOC, reader.as_ref());
    let start = harness.publish(doc_event("document.created")).await;
    harness.publish(doc_event("document.updated")).await;

    // The cursor is ignored (no replay), `document.*` is a literal name, and
    // preview events never arrive.
    let mut stream = harness
        .open(
            person(&reader),
            WebhookScope::User,
            filter(&["document.*", "document.updated", "document.content_changed"]),
            Some(start.to_string()),
        )
        .await
        .unwrap();
    harness.publish(doc_event("document.deleted")).await;
    harness
        .publish(preview_event("document.content_changed"))
        .await;
    let stable = event("document.updated", "document", DOC);
    let event_id = stable.event_id.clone();
    harness
        .publish(public(stable, entity(EntityType::Document, DOC)))
        .await;

    assert_eq!(
        next_id(&mut stream).await,
        Some(event_id),
        "SSE ids are broker event ids"
    );
    assert_eq!(next_id(&mut stream).await, None);
}

#[tokio::test(start_paused = true)]
async fn with_the_flag_preview_events_and_wildcards_arrive() {
    let (harness, reader) = flagged();
    let mut stream = harness
        .open(person(&reader), WebhookScope::User, filter(&["*"]), None)
        .await
        .unwrap();

    harness.publish(preview_event("document.updated")).await;

    assert!(next_id(&mut stream).await.is_some());
}

#[tokio::test(start_paused = true)]
async fn invalid_filters_are_refused() {
    let harness = Harness::default();
    let reader = user("reader@example.com");

    let opened = harness
        .open(
            person(&reader),
            WebhookScope::User,
            filter(&["doc*ument"]),
            None,
        )
        .await;

    assert!(matches!(opened, Err(StreamError::BadRequest(_))));
}

#[tokio::test(start_paused = true)]
async fn team_scope_needs_a_team() {
    let harness = Harness::default();
    let loner = user("loner@example.com");

    let opened = harness
        .open(
            person(&loner),
            WebhookScope::Team,
            filter(&["webhook.created"]),
            None,
        )
        .await;

    assert!(matches!(opened, Err(StreamError::BadRequest(_))));
}

#[tokio::test(start_paused = true)]
async fn a_lagging_tail_never_redelivers_what_precedes_the_cursor() {
    let (harness, reader) = flagged();
    let mut stream = harness
        .open(
            person(&reader),
            WebhookScope::User,
            filter(&["document.updated"]),
            Some("5000-0".to_owned()),
        )
        .await
        .unwrap();

    // The tail hands out an entry older than the client's cursor.
    harness
        .fan_out
        .deliver(crate::domain::models::LogEntry {
            cursor: Cursor { ms: 4_000, seq: 0 },
            record: doc_event("document.updated"),
            span: tracing::Span::none(),
        })
        .await;

    assert_eq!(next_id(&mut stream).await, None);
}

#[tokio::test(start_paused = true)]
async fn a_last_event_id_that_is_not_a_cursor_starts_live() {
    use crate::domain::stream::{EventStreamService as _, OpenStream, Resume};
    let (harness, reader) = flagged();

    let opened = harness
        .service
        .open_stream(OpenStream {
            principal: person(&reader),
            scope: WebhookScope::User,
            filters: filter(&["document.updated"]),
            resume: Some(Resume::LastEventId(
                "0193b3a0-0000-7000-8000-000000000001".to_owned(),
            )),
            credential: std::sync::Arc::new(FakeCredential(Default::default())),
        })
        .await;

    assert!(opened.is_ok());
}

#[tokio::test(start_paused = true)]
async fn a_cursor_ahead_of_the_clock_is_refused() {
    let (harness, reader) = flagged();
    let ahead = format!("{}-0", u64::MAX / 2);

    let opened = harness
        .open(
            person(&reader),
            WebhookScope::User,
            filter(&["document.updated"]),
            Some(ahead),
        )
        .await;

    assert!(matches!(opened, Err(StreamError::BadRequest(_))));
}

#[tokio::test(start_paused = true)]
async fn an_event_held_for_coalescing_keeps_the_resume_point_before_it() {
    let (harness, reader) = flagged();
    let mut stream = harness
        .open(
            person(&reader),
            WebhookScope::User,
            filter(&["document.interaction", "document.updated"]),
            None,
        )
        .await
        .unwrap();

    harness.publish(doc_event("document.interaction")).await;
    let held = harness.publish(doc_event("document.interaction")).await;
    harness.publish(doc_event("document.updated")).await;

    let _first = next_id(&mut stream).await;
    let updated_id: Cursor = next_id(&mut stream).await.unwrap().parse().unwrap();
    assert!(updated_id < held, "resuming from it replays the held event");
}

/// Unflagged streams keep the original contract: no concurrency limit, a 50
/// filter cap, no credential re-check, and a full buffer skips events
/// instead of closing the stream.
mod unflagged {
    use super::*;

    fn reader_with_access() -> (Harness, macro_user_id::user_id::MacroUserIdStr<'static>) {
        let harness = Harness::default();
        let reader = user("reader@example.com");
        harness
            .access
            .grant(EntityType::Document, DOC, reader.as_ref());
        (harness, reader)
    }

    #[tokio::test(start_paused = true)]
    async fn an_api_key_opens_more_than_five_streams() {
        let (harness, reader) = reader_with_access();
        let key = StreamPrincipal {
            kind: PrincipalKind::User {
                user: reader,
                api_key: true,
            },
            credential_id: "key-digest".to_owned(),
        };
        let mut open = Vec::new();
        for _ in 0..6 {
            open.push(
                harness
                    .open(
                        key.clone(),
                        WebhookScope::User,
                        filter(&["document.updated"]),
                        None,
                    )
                    .await
                    .unwrap(),
            );
        }
        assert_eq!(open.len(), 6);
    }

    #[tokio::test(start_paused = true)]
    async fn fifty_filters_are_accepted_and_the_flag_caps_at_32() {
        let (harness, reader) = reader_with_access();
        let fifty: Vec<_> = (0..50)
            .flat_map(|_| filter(&["document.updated"]))
            .collect();
        let thirty_three: Vec<_> = (0..33)
            .flat_map(|_| filter(&["document.updated"]))
            .collect();

        assert!(
            harness
                .open(person(&reader), WebhookScope::User, fifty, None)
                .await
                .is_ok()
        );
        harness.preview.enable(&reader);
        assert!(matches!(
            harness
                .open(person(&reader), WebhookScope::User, thirty_three, None)
                .await,
            Err(StreamError::BadRequest(_))
        ));
    }

    #[tokio::test(start_paused = true)]
    async fn an_expired_credential_does_not_close_the_stream() {
        let (harness, reader) = reader_with_access();
        let mut stream = harness
            .open(
                person(&reader),
                WebhookScope::User,
                filter(&["document.updated"]),
                None,
            )
            .await
            .unwrap();

        stream.valid.store(false, Ordering::SeqCst);
        tokio::time::sleep(REVALIDATE_INTERVAL * 2).await;
        harness.publish(doc_event("document.updated")).await;

        assert_eq!(
            stream.next_event_name().await.as_deref(),
            Some("document.updated")
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_stream_that_falls_behind_skips_events_and_carries_on() {
        let (harness, reader) = reader_with_access();
        let mut stream = harness
            .open(
                person(&reader),
                WebhookScope::User,
                filter(&["document.updated"]),
                None,
            )
            .await
            .unwrap();
        for _ in 0..(STREAM_BUFFER + 64) {
            harness.publish(doc_event("document.updated")).await;
        }

        let mut received = 0;
        while let Some(item) = stream.next_now().await {
            match item {
                StreamItem::Event { .. } => received += 1,
                StreamItem::Control(control) => panic!("unexpected control event {control:?}"),
            }
        }
        assert!(received < STREAM_BUFFER + 64, "some events were skipped");

        harness.publish(doc_event("document.updated")).await;
        assert_eq!(
            stream.next_event_name().await.as_deref(),
            Some("document.updated")
        );
    }
}
