//! Assembling the databases service from its Postgres and SQLite adapters.
//!
//! Every host — the HTTP service, the MCP service, the AI-tool contexts —
//! needs the *same* six adapters behind the service, and a host that wires a
//! different set is a host whose SQL behaves differently from everyone else's.
//! So the wiring lives here once and the roots call it, rather than each
//! repeating the constructor.
//!
//! The only things a host chooses are where table-changed liveness pings go
//! (a process with gateway credentials publishes, one without drops them) and
//! which broker carries the durable `macro.databases` events.

use macro_event_broker::MacroEventBroker;
use sqlx::PgPool;

use crate::domain::ports::TableEventPublisher;
use crate::domain::service::DatabasesServiceImpl;
use crate::outbound::magic::MagicTableRegistry;
use crate::outbound::pg_access_directory::PgAccessDirectory;
use crate::outbound::pg_databases_repo::PgDatabasesRepo;
use crate::outbound::pg_definition_store::PgDefinitionStore;
use crate::outbound::rusqlite_executor::{ExecutorLimits, RusqliteExecutor};

macro_env_var::maybe_env_vars! {
    /// Wall-clock budget per statement batch, in milliseconds.
    struct DatabasesSqlTimeoutMs;
    /// Maximum rows one result set may return.
    struct DatabasesSqlMaxResultRows;
    /// Maximum total bytes of text across all result sets.
    struct DatabasesSqlMaxResultBytes;
    /// Maximum row changes one statement batch may produce.
    struct DatabasesSqlMaxChanges;
    /// Maximum statement text length SQLite will accept, in bytes.
    struct DatabasesSqlMaxSqlBytes;
    /// Maximum length of a single string or blob value, in bytes.
    struct DatabasesSqlMaxValueBytes;
}

/// The service as every host builds it.
pub type PgDatabasesService<Events, Broker> = DatabasesServiceImpl<
    PgDatabasesRepo,
    PgDefinitionStore,
    MagicTableRegistry,
    RusqliteExecutor,
    Events,
    PgAccessDirectory,
    Broker,
>;

/// Read one optional numeric override, falling back to `default`.
///
/// An unparseable value is a deployment mistake, not a reason to run on a
/// silently different budget from the one that was configured, so it is
/// logged loudly and the default stands.
fn override_with(name: &str, raw: Option<&str>, default: usize) -> usize {
    let Some(raw) = raw else {
        return default;
    };
    match raw.trim().parse::<usize>() {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = ?error, env_var = name, value = raw, "ignoring unparseable databases SQL budget override");
            default
        }
    }
}

/// The SQL execution budget, with every knob overridable by an optional
/// environment variable and the compiled-in value as its default.
pub fn executor_limits_from_env() -> ExecutorLimits {
    let defaults = ExecutorLimits::default();
    ExecutorLimits {
        timeout: std::time::Duration::from_millis(override_with(
            "DATABASES_SQL_TIMEOUT_MS",
            DatabasesSqlTimeoutMs::new()
                .as_ref()
                .and_then(|v| v.value()),
            defaults.timeout.as_millis() as usize,
        ) as u64),
        max_result_rows: override_with(
            "DATABASES_SQL_MAX_RESULT_ROWS",
            DatabasesSqlMaxResultRows::new()
                .as_ref()
                .and_then(|v| v.value()),
            defaults.max_result_rows,
        ),
        max_result_bytes: override_with(
            "DATABASES_SQL_MAX_RESULT_BYTES",
            DatabasesSqlMaxResultBytes::new()
                .as_ref()
                .and_then(|v| v.value()),
            defaults.max_result_bytes,
        ),
        max_changes: override_with(
            "DATABASES_SQL_MAX_CHANGES",
            DatabasesSqlMaxChanges::new()
                .as_ref()
                .and_then(|v| v.value()),
            defaults.max_changes,
        ),
        max_sql_bytes: override_with(
            "DATABASES_SQL_MAX_SQL_BYTES",
            DatabasesSqlMaxSqlBytes::new()
                .as_ref()
                .and_then(|v| v.value()),
            defaults.max_sql_bytes,
        ),
        max_value_bytes: override_with(
            "DATABASES_SQL_MAX_VALUE_BYTES",
            DatabasesSqlMaxValueBytes::new()
                .as_ref()
                .and_then(|v| v.value()),
            defaults.max_value_bytes,
        ),
    }
}

/// Build the databases service over `pool`, publishing table changes through
/// `events` and domain events through `broker`, with the SQL budget read from
/// the environment.
pub fn build_service<Events: TableEventPublisher, Broker: MacroEventBroker>(
    pool: PgPool,
    events: Events,
    broker: Broker,
) -> PgDatabasesService<Events, Broker> {
    build_service_with_limits(pool, events, broker, executor_limits_from_env())
}

/// [`build_service`] with an explicit budget, for tests and benchmarks that
/// need a budget the environment does not describe.
pub fn build_service_with_limits<Events: TableEventPublisher, Broker: MacroEventBroker>(
    pool: PgPool,
    events: Events,
    broker: Broker,
    limits: ExecutorLimits,
) -> PgDatabasesService<Events, Broker> {
    DatabasesServiceImpl::new(
        PgDatabasesRepo::new(pool.clone()),
        PgDefinitionStore::new(pool.clone()),
        MagicTableRegistry::new(pool.clone()),
        RusqliteExecutor::new(limits),
        events,
        PgAccessDirectory::new(pool),
        broker,
    )
}
