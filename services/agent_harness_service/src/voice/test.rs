use super::*;

#[test]
fn worker_dispatch_is_scoped_to_its_hosted_environment_or_local_stack() {
    assert_eq!(
        worker_name(Environment::Production, None),
        "macro-agent-voice-prod"
    );
    assert_eq!(
        worker_name(Environment::Develop, Some("ignored-local-project")),
        "macro-agent-voice-dev"
    );
    assert_eq!(
        worker_name(Environment::Local, None),
        "macro-agent-voice-local-macro"
    );
    assert_eq!(
        worker_name(Environment::Local, Some("macro-voice-test")),
        "macro-agent-voice-local-macro-voice-test"
    );
    assert_ne!(
        worker_name(Environment::Local, Some("macro-one")),
        worker_name(Environment::Local, Some("macro-two"))
    );
}
