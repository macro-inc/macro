// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! The connect and info query spans, captured from a client talking to the
//! fake server.

use std::cell::RefCell;
use std::fmt::Debug;
use std::sync::{Arc, Once};

use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing::{Instrument, Subscriber};
use tracing_subscriber::Layer;
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::registry::LookupSpan;

use crate::client::test::{connect_paired, harness, next_node};
use crate::errors::ClientError;

#[derive(Debug)]
struct CapturedSpan {
    name: &'static str,
    /// Parent first, root last.
    ancestors: Vec<&'static str>,
    fields: Vec<(String, String)>,
}

impl CapturedSpan {
    fn field(&self, name: &str) -> Option<&str> {
        self.fields
            .iter()
            .rev()
            .find(|(field, _)| field == name)
            .map(|(_, value)| value.as_str())
    }
}

/// What the test thread captured. Thread-local because the subscriber is
/// global: a scoped `set_default` loses callsites that tests on other
/// threads register first.
#[derive(Default)]
struct Captured {
    spans: Vec<CapturedSpan>,
    events: Vec<Vec<(String, String)>>,
}

thread_local! {
    static CAPTURED: RefCell<Option<Captured>> = const { RefCell::new(None) };
}

/// Starts capturing on this thread; returns what was captured when `run`
/// finishes.
async fn capture(run: impl Future<Output = ()>) -> Captured {
    static INSTALL: Once = Once::new();
    INSTALL.call_once(|| {
        tracing::subscriber::set_global_default(tracing_subscriber::registry().with(Capture))
            .expect("no other global subscriber in this test binary");
    });
    CAPTURED.with(|captured| *captured.borrow_mut() = Some(Captured::default()));
    run.await;
    CAPTURED.with(|captured| captured.borrow_mut().take().expect("capturing"))
}

struct Capture;

struct SpanIndex(usize);

struct Fields<'fields>(&'fields mut Vec<(String, String)>);

impl Visit for Fields<'_> {
    fn record_str(&mut self, field: &Field, value: &str) {
        self.0.push((field.name().to_owned(), value.to_owned()));
    }

    fn record_debug(&mut self, field: &Field, value: &dyn Debug) {
        self.0.push((field.name().to_owned(), format!("{value:?}")));
    }
}

impl<Inner> Layer<Inner> for Capture
where
    Inner: Subscriber + for<'lookup> LookupSpan<'lookup>,
{
    fn on_new_span(&self, attrs: &Attributes<'_>, id: &Id, context: Context<'_, Inner>) {
        CAPTURED.with(|captured| {
            let mut captured = captured.borrow_mut();
            let Some(captured) = captured.as_mut() else {
                return;
            };
            let span = context.span(id).expect("the new span is registered");
            let ancestors = span
                .scope()
                .skip(1)
                .map(|ancestor| ancestor.name())
                .collect();
            let mut fields = Vec::new();
            attrs.record(&mut Fields(&mut fields));
            captured.spans.push(CapturedSpan {
                name: span.name(),
                ancestors,
                fields,
            });
            span.extensions_mut()
                .insert(SpanIndex(captured.spans.len() - 1));
        });
    }

    fn on_record(&self, id: &Id, values: &Record<'_>, context: Context<'_, Inner>) {
        CAPTURED.with(|captured| {
            let mut captured = captured.borrow_mut();
            let Some(captured) = captured.as_mut() else {
                return;
            };
            let span = context.span(id).expect("the recorded span is registered");
            let extensions = span.extensions();
            if let Some(SpanIndex(index)) = extensions.get::<SpanIndex>() {
                values.record(&mut Fields(&mut captured.spans[*index].fields));
            }
        });
    }

    fn on_event(&self, event: &tracing::Event<'_>, _context: Context<'_, Inner>) {
        CAPTURED.with(|captured| {
            if let Some(captured) = captured.borrow_mut().as_mut() {
                let mut fields = Vec::new();
                event.record(&mut Fields(&mut fields));
                captured.events.push(fields);
            }
        });
    }
}

#[tokio::test(start_paused = true)]
async fn connect_and_info_queries_are_traced_without_jids() {
    let captured = capture(async {
        let account = tracing::info_span!("account");
        let mut harness = harness(Some(("1234:5@s.whatsapp.net", "9876:5@lid")));
        let mut connection = connect_paired(&mut harness)
            .instrument(account.clone())
            .await;

        let client = Arc::clone(&harness.client);
        let failed =
            tokio::spawn(async move { client.set_passive(true).await }.instrument(account.clone()));
        let request = next_node(&mut connection).await;
        connection
            .respond_iq_error(&request, 500, "internal-server-error")
            .await;
        failed.await.unwrap().unwrap_err();

        let client = Arc::clone(&harness.client);
        let timed_out = tokio::spawn(
            async move { client.set_passive(false).await }.instrument(account.clone()),
        );
        let _ignored = next_node(&mut connection).await;
        assert!(matches!(
            timed_out.await.unwrap(),
            Err(ClientError::IqTimedOut)
        ));
    })
    .await;

    let spans = &captured.spans;
    let named = |name: &str| -> Vec<&CapturedSpan> {
        spans.iter().filter(|span| span.name == name).collect()
    };

    let connect = named("whatsmeow.connect");
    assert_eq!(connect.len(), 1, "{connect:#?}");
    assert_eq!(connect[0].ancestors, ["account"]);
    assert_eq!(connect[0].field("reason"), Some("initial"));
    assert_eq!(connect[0].field("outcome"), Some("ok"));
    for phase in [
        "whatsmeow.connect.dial",
        "whatsmeow.connect.handshake",
        "whatsmeow.connect.login",
    ] {
        let phase_spans = named(phase);
        assert_eq!(phase_spans.len(), 1, "{phase}: {phase_spans:#?}");
        assert_eq!(
            phase_spans[0].ancestors,
            ["whatsmeow.connect", "account"],
            "{phase}"
        );
        assert_eq!(phase_spans[0].field("outcome"), Some("ok"), "{phase}");
    }

    let received = named("whatsmeow.handle_node");
    assert!(!received.is_empty());
    for span in &received {
        assert!(span.ancestors.contains(&"account"), "{span:#?}");
    }

    let iqs = named("whatsmeow.iq");
    let login_iqs: Vec<_> = iqs
        .iter()
        .filter(|span| span.ancestors.first() == Some(&"whatsmeow.connect.login"))
        .collect();
    assert!(
        login_iqs
            .iter()
            .any(|span| span.field("xmlns") == Some("encrypt")
                && span.field("kind") == Some("count")
                && span.field("outcome") == Some("ok")),
        "{login_iqs:#?}"
    );
    let passive: Vec<_> = iqs
        .iter()
        .filter(|span| span.field("xmlns") == Some("passive"))
        .collect();
    let failed = passive
        .iter()
        .find(|span| span.field("outcome") == Some("error"))
        .expect("the failed query has a span");
    assert_eq!(failed.field("error_code"), Some("500"));
    assert_eq!(failed.field("otel.status_code"), Some("ERROR"));
    assert_eq!(failed.field("iq_type"), Some("set"));
    assert_eq!(failed.field("kind"), Some("passive"));
    assert_eq!(failed.ancestors, ["account"]);
    let timed_out = passive
        .iter()
        .find(|span| span.field("outcome") == Some("timeout"))
        .expect("the timed out query has a span");
    assert_eq!(timed_out.field("otel.status_code"), Some("ERROR"));

    let values = spans
        .iter()
        .flat_map(|span| span.fields.iter())
        .chain(captured.events.iter().flatten());
    for (field, value) in values {
        for jid_part in ["@s.whatsapp.net", "@lid", "1234:5", "9876:5"] {
            assert!(
                !value.contains(jid_part),
                "field {field} holds a JID: {value}"
            );
        }
    }
}
