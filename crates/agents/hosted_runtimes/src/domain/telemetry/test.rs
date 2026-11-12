use super::*;
use opentelemetry::trace::TracerProvider;
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
use tracing_subscriber::prelude::*;

#[test]
fn durable_work_adopts_parent_before_entering_and_running_callbacks_link() {
    global::set_text_map_propagator(opentelemetry_sdk::propagation::TraceContextPropagator::new());
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));
    let parent = "00-11111111111111111111111111111111-2222222222222222-01";
    tracing::subscriber::with_default(subscriber, || {
        let span = tracing::info_span!(
            "durable.work",
            computer_id = "00000000-0000-4000-8000-000000000001",
            otel.status_code = tracing::field::Empty
        );
        attach(&span, Some(parent));
        let _entered = span.enter();
        assert!(
            traceparent()
                .expect("context is injected")
                .starts_with("00-11111111111111111111111111111111-")
        );
        effect_failed("create");
        let callback = tracing::info_span!("callback");
        let _entered_callback = callback.enter();
        resume(Some(
            "00-33333333333333333333333333333333-4444444444444444-01",
        ));
    });
    provider.force_flush().expect("flush spans");
    let spans = exporter.get_finished_spans().expect("read spans");
    let work = spans
        .iter()
        .find(|span| span.name == "durable.work")
        .expect("work span");
    assert_eq!(
        work.span_context.trace_id().to_string(),
        "11111111111111111111111111111111"
    );
    assert_eq!(work.parent_span_id.to_string(), "2222222222222222");
    assert!(matches!(
        work.status,
        opentelemetry::trace::Status::Error { .. }
    ));
    let callback = spans
        .iter()
        .find(|span| span.name == "callback")
        .expect("callback span");
    assert_eq!(callback.links.links.len(), 1);
    assert_eq!(
        callback.links.links[0].span_context.trace_id().to_string(),
        "33333333333333333333333333333333"
    );
}

fn attributes() -> SetupAttributes {
    SetupAttributes {
        computer_id: "00000000-0000-4000-8000-000000000001".to_owned(),
        team_id: "00000000-0000-4000-8000-000000000002".to_owned(),
        size: "small".to_owned(),
        host_id: Some("00000000-0000-4000-8000-000000000003".to_owned()),
        generation: 1,
        billing_kind: "stripe",
    }
}

#[test]
fn setup_waits_export_recorded_times_under_the_purchase_trace() {
    use crate::domain::lifecycle::Phase;
    use crate::domain::setup::SetupTimeline;
    use chrono::TimeZone;

    global::set_text_map_propagator(opentelemetry_sdk::propagation::TraceContextPropagator::new());
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let at = |seconds: i64| {
        chrono::Utc
            .timestamp_opt(1_800_000_000 + seconds, 0)
            .unwrap()
    };
    let mut setup = SetupTimeline::started(at(0));
    let mut finished = setup.advance(&Phase::Provisioning { start: true }, false, false, at(5));
    finished.extend(setup.advance(&Phase::Booting, false, false, at(20)));
    finished.extend(setup.advance(&Phase::Running, true, false, at(80)));

    setup_waits(
        &provider.tracer("test"),
        Some("00-11111111111111111111111111111111-2222222222222222-01"),
        &setup,
        &finished,
        &attributes(),
    );

    provider.force_flush().expect("flush spans");
    let spans = exporter.get_finished_spans().expect("read spans");
    let names: Vec<_> = spans.iter().map(|span| span.name.to_string()).collect();
    assert_eq!(
        names,
        [
            "computer.setup.payment",
            "computer.setup.create",
            "computer.setup.boot",
            "computer.setup"
        ]
    );
    for span in &spans {
        assert_eq!(
            span.span_context.trace_id().to_string(),
            "11111111111111111111111111111111"
        );
        assert_eq!(span.parent_span_id.to_string(), "2222222222222222");
        assert!(
            span.attributes
                .iter()
                .any(|value| value.key.as_str() == "computer_id"
                    && value.value.as_str() == "00000000-0000-4000-8000-000000000001")
        );
    }
    let boot = &spans[2];
    assert_eq!(boot.start_time, std::time::SystemTime::from(at(20)));
    assert_eq!(boot.end_time, std::time::SystemTime::from(at(80)));
    let total = &spans[3];
    assert_eq!(total.start_time, std::time::SystemTime::from(at(0)));
    assert_eq!(total.end_time, std::time::SystemTime::from(at(80)));
}

#[test]
fn work_joins_the_purchase_trace_only_while_setup_runs() {
    use crate::domain::ids::HostId;
    use crate::domain::lifecycle::{Billing, BillingPolicy, Context, Phase, provision};

    global::set_text_map_propagator(opentelemetry_sdk::propagation::TraceContextPropagator::new());
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));
    let host = HostId::new(uuid::Uuid::from_u128(3));
    let now = chrono::Utc::now();
    let (mut state, _) = provision(
        Billing::Comped {
            reason: "telemetry".to_owned(),
        },
        crate::domain::setup::SetupTimeline::started(now),
        None,
        Context {
            host,
            enrollment_generation: Default::default(),
            now,
            host_has_room: true,
            policy: BillingPolicy::from_days(14, 7).unwrap(),
        },
    );
    state.provision_traceparent =
        Some("00-11111111111111111111111111111111-2222222222222222-01".to_owned());
    tracing::subscriber::with_default(subscriber, || {
        let during = tracing::info_span!("during");
        adopt(&during, &state);
        drop(during.enter());
        let setup = state
            .setup
            .as_mut()
            .expect("provisioned computers time setup");
        setup.advance(&Phase::Running, true, false, now);
        let after = tracing::info_span!("after");
        adopt(&after, &state);
        drop(after.enter());
    });
    drop(provider.force_flush());
    let spans = exporter.get_finished_spans().expect("read spans");
    let during = spans.iter().find(|span| span.name == "during").unwrap();
    assert_eq!(
        during.span_context.trace_id().to_string(),
        "11111111111111111111111111111111"
    );
    let after = spans.iter().find(|span| span.name == "after").unwrap();
    assert_ne!(
        after.span_context.trace_id().to_string(),
        "11111111111111111111111111111111"
    );
    assert_eq!(after.links.links.len(), 1);
}

#[test]
fn traceparents_are_validated_without_a_propagator() {
    assert!(is_valid_traceparent(
        "00-11111111111111111111111111111111-2222222222222222-01"
    ));
    assert!(!is_valid_traceparent(
        "00-00000000000000000000000000000000-2222222222222222-01"
    ));
    assert!(!is_valid_traceparent(
        "00-11111111111111111111111111111111-0000000000000000-01"
    ));
    assert!(!is_valid_traceparent("00-xyz-2222222222222222-01"));
    assert!(!is_valid_traceparent("traceparent"));
}
