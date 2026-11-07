use super::Signal;
use uuid::Uuid;

#[test]
fn a_signal_reads_only_from_json() {
    let id = Uuid::now_v7();
    assert_eq!(
        Signal::parse(&format!(r#"{{"id":"{id}","traceparent":"00-ab-cd-01"}}"#)),
        Some(Signal {
            id,
            traceparent: Some("00-ab-cd-01".to_owned()),
        })
    );
    assert_eq!(
        Signal::parse(&format!(r#"{{"id":"{id}"}}"#)),
        Some(Signal {
            id,
            traceparent: None,
        })
    );
    assert_eq!(Signal::parse(&id.to_string()), None);
    assert_eq!(Signal::parse("not-an-id"), None);
    assert_eq!(Signal::parse(r#"{"id":"nope"}"#), None);
}
