//! Resolve-once fan-out against the old per-subscriber path (plan 7.2,
//! item 3), on the shapes production traffic has: `macro.email` (owner
//! audience, about 18 times `macro.documents`) and `macro.documents`
//! (entity audience).
//!
//! Run: `cargo nextest run -p event_stream --run-ignored only --no-capture fan_out::bench`.
//!
//! Access lookups go to an in-memory directory; the report counts them and
//! models their cost at the production p50 of `get_users_by_entity` for
//! documents (0.78 ms) next to the measured in-process time.

use crate::domain::models::{PrincipalKind, StreamPrincipal, WebhookScope};
use crate::domain::ports::AccessDirectory as _;
use crate::domain::test_support::*;
use event_exposure::{Audience, EntityType};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

const EVENTS: usize = 1_900;
const EMAIL_PER_DOCUMENT: usize = 18;
const DOCUMENT_ACCESSORS: usize = 20;
const LOOKUP_P50: Duration = Duration::from_micros(780);

struct Report {
    lookups: usize,
    elapsed: Duration,
}

fn subscriber(index: usize) -> macro_user_id::user_id::MacroUserIdStr<'static> {
    user(&format!("subscriber{index}@example.com"))
}

/// The event mix: one document update per `EMAIL_PER_DOCUMENT` mail events,
/// mail addressed round-robin to subscribers.
fn mix(subscribers: usize) -> Vec<(crate::domain::models::NormalizedEvent, Audience)> {
    (0..EVENTS)
        .map(|index| {
            if index % (EMAIL_PER_DOCUMENT + 1) == 0 {
                (
                    event("document.updated", "document", DOC),
                    entity(EntityType::Document, DOC),
                )
            } else {
                (
                    event("email.message_received", "email_thread", DOC),
                    Audience::Owner {
                        user_id: subscriber(index % subscribers),
                    },
                )
            }
        })
        .collect()
}

async fn resolve_once(subscribers: usize) -> Report {
    let harness = Harness::default();
    let mut streams = Vec::with_capacity(subscribers);
    for index in 0..subscribers {
        let user = subscriber(index);
        if index < DOCUMENT_ACCESSORS {
            harness
                .access
                .grant(EntityType::Document, DOC, user.as_ref());
        }
        streams.push(
            harness
                .open(
                    person(&user),
                    WebhookScope::User,
                    filter(&["document.updated", "email.message_received"]),
                    None,
                )
                .await
                .unwrap(),
        );
    }

    // Every client reads as fast as it can, so no stream lags.
    let readers: Vec<_> = streams
        .into_iter()
        .enumerate()
        .map(|(index, stream)| {
            let expected = expected_for(index, subscribers);
            tokio::spawn(async move {
                let mut items = stream.items;
                let mut received = 0_usize;
                while received < expected && futures::StreamExt::next(&mut items).await.is_some() {
                    received += 1;
                }
                received
            })
        })
        .collect();

    let started = Instant::now();
    for (event, audience) in mix(subscribers) {
        harness.publish(public(event, audience)).await;
    }
    let mut delivered = 0;
    for reader in readers {
        delivered += reader.await.unwrap();
    }
    let elapsed = started.elapsed();
    assert_eq!(delivered, expected_deliveries(subscribers));
    Report {
        lookups: harness.access.list_calls.load(Ordering::SeqCst)
            + harness.access.exact_calls.load(Ordering::SeqCst),
        elapsed,
    }
}

/// What subscriber `index` receives: its mail, and document updates when it
/// has access.
fn expected_for(index: usize, subscribers: usize) -> usize {
    mix(subscribers)
        .iter()
        .filter(|(_, audience)| match audience {
            Audience::Owner { user_id } => *user_id == subscriber(index),
            _ => index < DOCUMENT_ACCESSORS,
        })
        .count()
}

/// Each mail reaches its one owner; each document update reaches every
/// subscriber with access.
fn expected_deliveries(subscribers: usize) -> usize {
    let documents = EVENTS.div_ceil(EMAIL_PER_DOCUMENT + 1);
    (EVENTS - documents) + documents * subscribers.min(DOCUMENT_ACCESSORS)
}

/// The removed path: every subscriber filters each event and, for an entity
/// audience, lists the entity's accessors itself.
async fn per_subscriber(subscribers: usize) -> Report {
    let access = FakeAccess::default();
    let principals: Vec<StreamPrincipal> = (0..subscribers)
        .map(|index| {
            let user = subscriber(index);
            if index < DOCUMENT_ACCESSORS {
                access.grant(EntityType::Document, DOC, user.as_ref());
            }
            person(&user)
        })
        .collect();
    let filters = filter(&["document.updated", "email.message_received"]);

    let started = Instant::now();
    let mut delivered = 0_usize;
    for (event, audience) in mix(subscribers) {
        for principal in &principals {
            let PrincipalKind::User { user, .. } = &principal.kind else {
                continue;
            };
            if !filters
                .iter()
                .any(|filter| filter.events.contains(&event.event_name))
            {
                continue;
            }
            let admitted = match &audience {
                Audience::Entity {
                    entity_type,
                    entity_id,
                } => access
                    .accessors(*entity_type, entity_id)
                    .await
                    .unwrap()
                    .iter()
                    .any(|accessor| accessor == user.as_ref()),
                Audience::Owner { user_id } => user_id == user,
                _ => false,
            };
            delivered += usize::from(admitted);
        }
    }
    let elapsed = started.elapsed();
    assert_eq!(delivered, expected_deliveries(subscribers));
    Report {
        lookups: access.list_calls.load(Ordering::SeqCst),
        elapsed,
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "benchmark; run explicitly"]
async fn resolve_once_against_per_subscriber() {
    println!(
        "{EVENTS} events ({} document.updated, the rest email.message_received); lookup cost modelled at {LOOKUP_P50:?}",
        EVENTS.div_ceil(EMAIL_PER_DOCUMENT + 1)
    );
    println!(
        "| subscribers | path | access lookups | in-process (to every client) | modelled lookup time |"
    );
    println!("| --- | --- | --- | --- | --- |");
    for subscribers in [1, 100, 5_000] {
        for (name, report) in [
            ("resolve once", resolve_once(subscribers).await),
            ("per subscriber", per_subscriber(subscribers).await),
        ] {
            println!(
                "| {subscribers} | {name} | {} | {:?} | {:?} |",
                report.lookups,
                report.elapsed,
                LOOKUP_P50 * u32::try_from(report.lookups).unwrap_or(u32::MAX),
            );
        }
    }
}
