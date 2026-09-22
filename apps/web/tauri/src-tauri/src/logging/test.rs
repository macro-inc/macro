use super::*;
use tracing::Level;
use tracing_subscriber::layer::SubscriberExt;

#[test]
fn defaults_suppress_turso_hot_path_logs_but_preserve_failures() {
    for debug in [true, false] {
        let subscriber = tracing_subscriber::registry().with(default_filter(debug));
        tracing::subscriber::with_default(subscriber, || {
            assert!(!tracing::enabled!(target: "turso_core::storage::btree", Level::TRACE));
            assert!(!tracing::enabled!(target: "turso_core::storage::btree", Level::DEBUG));
            assert!(!tracing::enabled!(target: "turso_core::storage::pager", Level::INFO));
            assert!(tracing::enabled!(target: "turso_core::storage::pager", Level::WARN));
            assert!(tracing::enabled!(target: "turso_core::storage::pager", Level::ERROR));
        });
    }
}

#[test]
fn defaults_retain_app_debugging_and_dependency_filters() {
    for debug in [true, false] {
        let subscriber = tracing_subscriber::registry().with(default_filter(debug));
        tracing::subscriber::with_default(subscriber, || {
            assert_eq!(tracing::enabled!(target: "app_lib", Level::DEBUG), debug);
            assert_eq!(tracing::enabled!(target: "tao", Level::DEBUG), debug);
            assert!(tracing::enabled!(target: "app_lib", Level::INFO));
            assert!(!tracing::enabled!(target: "app_lib", Level::TRACE));
            assert!(!tracing::enabled!(target: "reqwest", Level::DEBUG));
            assert!(tracing::enabled!(target: "reqwest", Level::INFO));
        });
    }
}

#[test]
fn turso_debugging_can_be_explicitly_enabled() {
    let filter = default_filter(true).add_directive("turso_core=debug".parse().unwrap());
    tracing::subscriber::with_default(tracing_subscriber::registry().with(filter), || {
        assert!(tracing::enabled!(target: "turso_core::storage::btree", Level::DEBUG));
        assert!(!tracing::enabled!(target: "turso_core::storage::btree", Level::TRACE));
    });
}
