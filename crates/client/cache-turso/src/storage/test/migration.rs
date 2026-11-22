//! Storage upgrades: the registered historical step, the reset fallbacks, and
//! the runner over generated chains of schema changes with interruptions.
use super::*;
use crate::storage::migration::{StorageUpgradeStep, run_steps, test_hooks};
use proptest::prelude::*;
use proptest::test_runner::{Config, TestCaseError, TestRunner};
use std::path::Path;

/// The storage 11 shape, from the parent of the commit that introduced 12:
/// the browse index without the text and hash columns and no contact index.
fn downgrade_to_storage_11(storage: &mut TursoStorage) {
    test_hooks::rewrite_as_storage_11(storage).unwrap();
}

fn contact(name: &str) -> Record {
    let mut record = Record::default();
    record.fields.insert(
        "__typename".into(),
        cache_core::value::CacheValue::String("GraphqlContact".into()),
    );
    record.fields.insert(
        "name".into(),
        cache_core::value::CacheValue::String(name.into()),
    );
    record
}

async fn populate(storage: &mut TursoStorage) {
    let mut records = Vec::new();
    for index in 0..40 {
        records.push((
            key(&format!("Thing:{index}")),
            record(&format!("value {index}")),
        ));
        records.push((
            key(&format!("GraphqlSoupDocument:{index}")),
            quick_access_document(&format!("Document {index}"), 1_000 + index),
        ));
        records.push((
            key(&format!("GraphqlContact:{index}")),
            contact(&format!("Person {index}")),
        ));
    }
    storage.put_batch(records).await.unwrap();
    for label in ["First", "Second", "Third"] {
        storage.enqueue_mutation(queued(label)).await.unwrap();
    }
}

/// Every schema object with its definition, minus root pages.
fn schema_rows(connection: &Arc<Connection>) -> Vec<String> {
    driver::query(
        connection,
        "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
        vec![],
    )
    .unwrap()
    .into_iter()
    .map(|row| format!("{row:?}"))
    .collect()
}

/// What the frozen-schema checks read: columns, keys, foreign keys and index
/// columns of every table, independent of how the DDL text was written.
fn schema_fingerprint(connection: &Arc<Connection>) -> Vec<String> {
    let mut lines = Vec::new();
    let tables = driver::query(
        connection,
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        vec![],
    )
    .unwrap();
    for table in tables {
        let table = required_text(&table, 0).unwrap();
        for pragma in ["table_xinfo", "foreign_key_list"] {
            for row in
                driver::query(connection, &format!("PRAGMA {pragma}('{table}')"), vec![]).unwrap()
            {
                lines.push(format!("{table} {pragma} {row:?}"));
            }
        }
        let mut indexes =
            driver::query(connection, &format!("PRAGMA index_list('{table}')"), vec![]).unwrap();
        indexes.sort_by_key(|row| required_text(row, 1).unwrap());
        for index in indexes {
            let name = required_text(&index, 1).unwrap();
            lines.push(format!("{table} index {:?}", &index[1..]));
            for row in
                driver::query(connection, &format!("PRAGMA index_xinfo('{name}')"), vec![]).unwrap()
            {
                lines.push(format!("{table} {name} {row:?}"));
            }
        }
    }
    lines
}

/// Every row of every table, in a stable order.
fn table_rows(connection: &Arc<Connection>) -> Vec<String> {
    let mut lines = Vec::new();
    let tables = driver::query(
        connection,
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        vec![],
    )
    .unwrap();
    for table in tables {
        let table = required_text(&table, 0).unwrap();
        let columns = driver::query(
            connection,
            &format!("PRAGMA table_xinfo('{table}')"),
            vec![],
        )
        .unwrap();
        let order = (1..=columns.len())
            .map(|position| position.to_string())
            .collect::<Vec<_>>()
            .join(", ");
        for row in driver::query(
            connection,
            &format!("SELECT * FROM {table} ORDER BY {order}"),
            vec![],
        )
        .unwrap()
        {
            lines.push(format!("{table} {row:?}"));
        }
    }
    lines
}

fn stored_storage_version(connection: &Arc<Connection>) -> i64 {
    let rows = driver::query(
        connection,
        "SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'storage_schema_version'",
        vec![],
    )
    .unwrap();
    required_i64(&rows[0], 0).unwrap()
}

#[test]
fn storage_11_cache_is_upgraded_in_place_keeping_records_queue_and_generation() {
    block_on(async {
        let directory = tempfile::tempdir().unwrap();
        let database = TursoFileDatabase::new(directory.path().join("cache.turso")).unwrap();
        let mut engine = cache_core::engine::Engine::new(database.open("scope").unwrap());
        let generation = engine.current_storage_generation().await.unwrap();
        let mut storage = engine.into_storage();
        populate(&mut storage).await;
        let fresh_schema = schema_rows(&storage.connection());
        let fresh_fingerprint = schema_fingerprint(&storage.connection());
        let rows = table_rows(&storage.connection());
        let pending = storage.load_mutation_queue().await.unwrap();
        downgrade_to_storage_11(&mut storage);
        assert_ne!(schema_rows(&storage.connection()), fresh_schema);
        storage.try_close().unwrap();

        let storage = database.open("scope").unwrap();
        let connection = storage.connection();
        assert_eq!(
            stored_storage_version(&connection),
            i64::from(STORAGE_SCHEMA_VERSION)
        );
        // Byte-identical definitions, so a digest of sqlite_schema matches too.
        assert_eq!(schema_rows(&connection), fresh_schema);
        assert_eq!(schema_fingerprint(&connection), fresh_fingerprint);
        assert_eq!(table_rows(&connection), rows);
        assert_eq!(storage.load_mutation_queue().await.unwrap(), pending);
        assert_eq!(
            storage
                .get_batch(&[key("Thing:7"), key("GraphqlContact:7")])
                .await
                .unwrap(),
            vec![Some(record("value 7")), Some(contact("Person 7"))]
        );
        drop(connection);
        let mut engine = cache_core::engine::Engine::new(storage);
        assert_eq!(
            engine.current_storage_generation().await.unwrap(),
            generation
        );
        engine.into_storage().try_close().unwrap();
    });
}

#[test]
fn upgrade_reports_the_previous_version_once() {
    let database = TursoMemoryDatabase::new("reports-upgrade.db");
    let mut storage = database.open("scope").unwrap();
    downgrade_to_storage_11(&mut storage);
    storage.try_close().unwrap();
    let state = database.state.lock().unwrap();
    let open = || {
        let raw = Database::open(
            state.io.clone(),
            &database.path,
            OpenOptions::new(Arc::new(SqliteDialect)),
        )
        .unwrap();
        let connection = raw.connect().unwrap();
        let initialized = initialize(&connection, "scope", false).unwrap();
        connection.close().unwrap();
        initialized
    };
    assert_eq!(
        open(),
        Initialized {
            format_migrated: false,
            storage_upgraded_from: Some(11),
        }
    );
    assert_eq!(open(), Initialized::default(), "nothing is left to upgrade");
}

#[test]
fn versions_without_a_chain_and_failing_steps_still_reset() {
    block_on(async {
        for (name, sql) in [
            (
                "newer",
                "UPDATE meta SET value = '13' WHERE key = 'storage_schema_version'",
            ),
            (
                "older-than-every-step",
                "UPDATE meta SET value = '10' WHERE key = 'storage_schema_version'",
            ),
            (
                "unparsable",
                "UPDATE meta SET value = 'eleven' WHERE key = 'storage_schema_version'",
            ),
            (
                "missing",
                "DELETE FROM meta WHERE key = 'storage_schema_version'",
            ),
            // Claims 11 but already has the contact index, so the step's
            // CREATE INDEX fails and the whole step rolls back.
            (
                "partial-11",
                "UPDATE meta SET value = '11' WHERE key = 'storage_schema_version'",
            ),
        ] {
            let database = TursoMemoryDatabase::new(format!("no-chain-{name}.db"));
            let mut storage = database.open("scope").unwrap();
            populate(&mut storage).await;
            raw_execute(&storage, sql, Vec::new());
            let before = table_rows(&storage.connection());
            storage.try_close().unwrap();
            expect_reset_reason(database.open("scope"), PhysicalResetReason::Compatibility);

            if name == "partial-11" {
                // The failed step changed nothing: same rows, still 11.
                let state = database.state.lock().unwrap();
                let raw = Database::open(
                    state.io.clone(),
                    &database.path,
                    OpenOptions::new(Arc::new(SqliteDialect)),
                )
                .unwrap();
                let connection = raw.connect().unwrap();
                assert_eq!(table_rows(&connection), before, "case {name}");
                assert_eq!(stored_storage_version(&connection), 11);
                connection.close().unwrap();
            }
        }
    });
}

/// The frozen-schema checks run inside the last step's transaction: a chain
/// whose result they reject leaves the file exactly as the older build wrote
/// it, still at the older version, so the browser can hand it back.
#[test]
fn a_rejected_upgrade_leaves_the_older_file_untouched() {
    block_on(async {
        let database = TursoMemoryDatabase::new("rejected-upgrade.db");
        let mut storage = database.open("scope").unwrap();
        populate(&mut storage).await;
        test_hooks::add_unknown_table(&mut storage).unwrap();
        downgrade_to_storage_11(&mut storage);
        let schema = schema_rows(&storage.connection());
        let rows = table_rows(&storage.connection());
        storage.try_close().unwrap();
        expect_reset_reason(database.open("scope"), PhysicalResetReason::Compatibility);

        let state = database.state.lock().unwrap();
        let raw = Database::open(
            state.io.clone(),
            &database.path,
            OpenOptions::new(Arc::new(SqliteDialect)),
        )
        .unwrap();
        let connection = raw.connect().unwrap();
        assert_eq!(
            crate::storage::migration::stored_storage_version(&connection),
            Some(11)
        );
        assert_eq!(schema_rows(&connection), schema);
        assert_eq!(table_rows(&connection), rows);
        connection.close().unwrap();
    });
}

#[test]
fn hook_stops_after_a_committed_step_and_the_next_open_finishes() {
    block_on(async {
        let directory = tempfile::tempdir().unwrap();
        let database = TursoFileDatabase::new(directory.path().join("cache.turso")).unwrap();
        let mut storage = database.open("scope").unwrap();
        populate(&mut storage).await;
        let rows = table_rows(&storage.connection());
        downgrade_to_storage_11(&mut storage);
        storage.try_close().unwrap();

        test_hooks::interrupt_after_steps(Some(1));
        let error = database.open_or_reset("scope").unwrap_err();
        test_hooks::interrupt_after_steps(None);
        assert!(!error.requires_physical_reset());
        assert!(test_hooks::take_interrupted());
        assert!(!test_hooks::take_interrupted());

        let storage = database.open("scope").unwrap();
        assert_eq!(table_rows(&storage.connection()), rows);
        storage.try_close().unwrap();
    });
}

// ---------------------------------------------------------------------------
// Generated chains: the runner over random schema changes on a populated file.

/// The tables generated changes touch, with a text or integer column each.
const TARGETS: [(&str, &str); 5] = [
    ("records", "id"),
    ("search_documents", "search_text"),
    ("mutation_queue", "query"),
    ("optimistic_layers", "optimistic_data_json"),
    ("meta", "value"),
];
/// Derived changes read only the first targets: `meta` holds the version the
/// runner itself advances, so a copy of it differs by design.
const DERIVED_TARGETS: usize = 4;

#[derive(Clone, Debug)]
enum Change {
    AddIndex { table: usize, descending: bool },
    DropGeneratedIndex,
    AddColumn { table: usize, default: i64 },
    AddDerivedColumn { table: usize },
    AddDerivedTable { table: usize },
}

fn change() -> impl Strategy<Value = Change> {
    prop_oneof![
        (0..TARGETS.len(), any::<bool>())
            .prop_map(|(table, descending)| Change::AddIndex { table, descending }),
        Just(Change::DropGeneratedIndex),
        (0..TARGETS.len(), -5_i64..5)
            .prop_map(|(table, default)| Change::AddColumn { table, default }),
        (0..DERIVED_TARGETS).prop_map(|table| Change::AddDerivedColumn { table }),
        (0..DERIVED_TARGETS).prop_map(|table| Change::AddDerivedTable { table }),
    ]
}

#[derive(Clone, Copy, Debug)]
enum Interruption {
    None,
    /// The step fails after its first statement; its transaction rolls back.
    FailMidStep(usize),
    /// The files are copied mid-step, as a process killed there leaves them.
    CrashMidStep(usize),
    /// The files are copied right after the step commits, before a checkpoint.
    CrashAfterStep(usize),
    /// The checks inside the last step's transaction reject what the chain
    /// built, so that step rolls back.
    RejectedByValidation,
}

fn interruption(steps: usize) -> impl Strategy<Value = Interruption> {
    prop_oneof![
        Just(Interruption::None),
        (0..steps).prop_map(Interruption::FailMidStep),
        (0..steps).prop_map(Interruption::CrashMidStep),
        (0..steps).prop_map(Interruption::CrashAfterStep),
        Just(Interruption::RejectedByValidation),
    ]
}

/// One generated step: the SQL the upgrade runs, and how a build that already
/// has the change creates the same object from scratch.
#[derive(Clone, Debug, Default)]
struct PlannedStep {
    upgrade: Vec<String>,
}

#[derive(Clone, Debug, Default)]
struct FreshSchema {
    added_columns: Vec<(String, String)>,
    indexes: Vec<(String, String)>,
    derived: Vec<String>,
}

fn plan(changes: &[Change]) -> (Vec<PlannedStep>, FreshSchema) {
    let mut steps = Vec::new();
    let mut fresh = FreshSchema::default();
    for (number, change) in changes.iter().enumerate() {
        let mut step = PlannedStep::default();
        match change {
            Change::AddIndex { table, descending } => {
                let (table, column) = TARGETS[*table];
                let order = if *descending { " DESC" } else { "" };
                let sql =
                    format!("CREATE INDEX generated_index_{number} ON {table}({column}{order})");
                step.upgrade.push(sql.clone());
                fresh
                    .indexes
                    .push((format!("generated_index_{number}"), sql));
            }
            Change::DropGeneratedIndex => {
                if let Some((name, _)) = fresh.indexes.pop() {
                    step.upgrade.push(format!("DROP INDEX {name}"));
                }
            }
            Change::AddColumn { table, default } => {
                let (table, _) = TARGETS[*table];
                let definition = format!("generated_{number} INTEGER NOT NULL DEFAULT {default}");
                step.upgrade
                    .push(format!("ALTER TABLE {table} ADD COLUMN {definition}"));
                fresh.added_columns.push((table.to_owned(), definition));
            }
            Change::AddDerivedColumn { table } => {
                let (table, source) = TARGETS[*table];
                let definition = format!("generated_{number} INTEGER NOT NULL DEFAULT 0");
                let fill = format!("UPDATE {table} SET generated_{number} = length({source})");
                step.upgrade
                    .push(format!("ALTER TABLE {table} ADD COLUMN {definition}"));
                step.upgrade.push(fill.clone());
                fresh.added_columns.push((table.to_owned(), definition));
                fresh.derived.push(fill);
            }
            Change::AddDerivedTable { table } => {
                let (table, source) = TARGETS[*table];
                let create = format!(
                    "CREATE TABLE generated_{number} (id INTEGER PRIMARY KEY, source TEXT NOT NULL, size INTEGER NOT NULL)"
                );
                let fill = format!(
                    "INSERT INTO generated_{number} (source, size) SELECT {source}, length({source}) FROM {table} ORDER BY {source}"
                );
                step.upgrade.push(create.clone());
                step.upgrade.push(fill.clone());
                fresh.derived.push(create);
                fresh.derived.push(fill);
            }
        }
        steps.push(step);
    }
    (steps, fresh)
}

/// Adds a column to a frozen `CREATE TABLE` the way a build that always had it
/// would write it: after the last column, before any table constraint.
fn with_column(create: &str, definition: &str) -> String {
    let body_end = create.rfind(')').unwrap();
    let constraint = [", PRIMARY KEY (", ", FOREIGN KEY ("]
        .into_iter()
        .filter_map(|marker| create.find(marker))
        .min()
        .unwrap_or(body_end);
    format!(
        "{}, {definition}{}",
        &create[..constraint],
        &create[constraint..]
    )
}

fn table_of(create: &str) -> Option<&str> {
    create
        .strip_prefix("CREATE TABLE ")
        .and_then(|rest| rest.split([' ', '(']).next())
}

fn copy_files(from: &Path, to: &Path) {
    for suffix in COMPANION_SUFFIXES {
        let source = companion_path(from, suffix);
        if source.exists() {
            std::fs::copy(source, companion_path(to, suffix)).unwrap();
        }
    }
}

fn raw_open(path: &Path) -> (Arc<Database>, Arc<Connection>) {
    let io: Arc<dyn IO> = Arc::new(PlatformIO::new().unwrap());
    let database = Database::open(
        io,
        path.to_str().unwrap(),
        OpenOptions::new(Arc::new(SqliteDialect)),
    )
    .unwrap();
    let connection = database.connect().unwrap();
    enable_foreign_keys(&connection).unwrap();
    (database, connection)
}

fn leak_steps(
    planned: &[PlannedStep],
    base: u32,
    interruption: Interruption,
    crash_copy: &Path,
    live: &Path,
) -> &'static [StorageUpgradeStep] {
    let steps = planned
        .iter()
        .enumerate()
        .map(|(index, step)| {
            let statements = step.upgrade.clone();
            let crash_copy = crash_copy.to_owned();
            let live = live.to_owned();
            let apply = move |connection: &Arc<Connection>| -> Result<(), TursoStorageError> {
                for (position, sql) in statements.iter().enumerate() {
                    driver::execute(connection, sql, Vec::new())?;
                    if position == 0 {
                        match interruption {
                            Interruption::FailMidStep(at) if at == index => {
                                return Err(TursoStorageError::Database);
                            }
                            Interruption::CrashMidStep(at) if at == index => {
                                copy_files(&live, &crash_copy);
                            }
                            _ => {}
                        }
                    }
                }
                if statements.is_empty() {
                    match interruption {
                        Interruption::FailMidStep(at) if at == index => {
                            return Err(TursoStorageError::Database);
                        }
                        Interruption::CrashMidStep(at) if at == index => {
                            copy_files(&live, &crash_copy);
                        }
                        _ => {}
                    }
                }
                Ok(())
            };
            StorageUpgradeStep {
                from: base + u32::try_from(index).unwrap(),
                apply: Box::leak(Box::new(apply)),
            }
        })
        .collect::<Vec<_>>();
    Box::leak(steps.into_boxed_slice())
}

/// Builds what a build with every change creates from scratch, holding the
/// same logical rows as `source`.
fn fresh_at_target(source: &Arc<Connection>, fresh: &FreshSchema, path: &Path, version: u32) {
    let (_database, connection) = raw_open(path);
    let mut creates = CREATE_SCHEMA
        .into_iter()
        .chain(calendar::CREATE_SCHEMA)
        .map(str::to_owned)
        .collect::<Vec<_>>();
    for (table, definition) in &fresh.added_columns {
        let create = creates
            .iter_mut()
            .find(|create| table_of(create) == Some(table.as_str()))
            .unwrap();
        *create = with_column(create, definition);
    }
    for sql in &creates {
        driver::execute(&connection, sql, Vec::new()).unwrap();
    }
    // Copy each original table's rows, as the same writes would have left them.
    for create in &creates {
        let Some(table) = table_of(create) else {
            continue;
        };
        let columns = driver::query(source, &format!("PRAGMA table_xinfo('{table}')"), vec![])
            .unwrap()
            .into_iter()
            .map(|row| required_text(&row, 1).unwrap())
            .filter(|column| !column.starts_with("generated_"))
            .collect::<Vec<_>>();
        let list = columns.join(", ");
        let placeholders = vec!["?"; columns.len()].join(", ");
        for row in driver::query(
            source,
            &format!("SELECT {list} FROM {table} ORDER BY rowid"),
            vec![],
        )
        .unwrap()
        {
            driver::execute(
                &connection,
                &format!("INSERT INTO {table} ({list}) VALUES ({placeholders})"),
                row,
            )
            .unwrap();
        }
    }
    for sql in fresh
        .derived
        .iter()
        .chain(fresh.indexes.iter().map(|(_, sql)| sql))
    {
        driver::execute(&connection, sql, Vec::new()).unwrap();
    }
    driver::execute(
        &connection,
        "UPDATE meta SET value = ?1 WHERE key = 'storage_schema_version'",
        vec![text(&version.to_string())],
    )
    .unwrap();
    connection.close().unwrap();
}

fn check_generated_chain(
    seed: &Path,
    changes: &[Change],
    interruption: Interruption,
) -> Result<(), TestCaseError> {
    let directory = tempfile::tempdir().unwrap();
    let live = directory.path().join("live.turso");
    let crashed = directory.path().join("crashed.turso");
    let expected = directory.path().join("fresh.turso");
    copy_files(seed, &live);
    let base = STORAGE_SCHEMA_VERSION;
    let target = base + u32::try_from(changes.len()).unwrap();
    let (planned, fresh) = plan(changes);
    let steps = leak_steps(&planned, base, interruption, &crashed, &live);

    let (database, connection) = raw_open(&live);
    {
        let (_source_db, source) = raw_open(seed);
        fresh_at_target(&source, &fresh, &expected, target);
        source.close().unwrap();
    }
    // The last step checks what the chain built against the fresh schema, as
    // the frozen-schema checks do for the registered steps.
    let expected_schema = {
        let (_expected_db, expected) = raw_open(&expected);
        let schema = schema_fingerprint(&expected);
        expected.close().unwrap();
        schema
    };
    let accept_expected = |connection: &Arc<Connection>| {
        if schema_fingerprint(connection) != expected_schema {
            return Err(compatibility());
        }
        Ok(())
    };
    let validate = |connection: &Arc<Connection>| match interruption {
        Interruption::RejectedByValidation => Err(compatibility()),
        _ => accept_expected(connection),
    };

    if let Interruption::CrashAfterStep(at) = interruption {
        test_hooks::interrupt_after_steps(Some(u32::try_from(at + 1).unwrap()));
    }
    let first = run_steps(&connection, steps, target, &validate);
    test_hooks::interrupt_after_steps(None);
    let interrupted = test_hooks::take_interrupted();
    if let Interruption::CrashAfterStep(_) = interruption {
        prop_assert!(interrupted);
        copy_files(&live, &crashed);
    }

    // Whatever happened, a later open of the file that is left must finish
    // the chain and reach exactly the fresh state.
    let survivor = match interruption {
        Interruption::None => {
            prop_assert_eq!(first, Ok(Some(base)));
            connection.close().unwrap();
            drop(database);
            live.clone()
        }
        Interruption::FailMidStep(at) => {
            prop_assert_eq!(
                first,
                Err(TursoStorageError::PhysicalResetRequired(
                    PhysicalResetReason::Compatibility
                ))
            );
            // The failed step rolled back to the boundary before it.
            prop_assert_eq!(
                stored_storage_version(&connection),
                i64::from(base) + i64::try_from(at).unwrap()
            );
            connection.close().unwrap();
            drop(database);
            live.clone()
        }
        Interruption::RejectedByValidation => {
            prop_assert_eq!(
                first,
                Err(TursoStorageError::PhysicalResetRequired(
                    PhysicalResetReason::Compatibility
                ))
            );
            // Every step before the last committed; the last rolled back with
            // the checks, so the file still says the version before it.
            prop_assert_eq!(stored_storage_version(&connection), i64::from(target) - 1);
            connection.close().unwrap();
            drop(database);
            live.clone()
        }
        Interruption::CrashMidStep(_) | Interruption::CrashAfterStep(_) => {
            connection.close().unwrap();
            drop(database);
            crashed.clone()
        }
    };
    let clean = leak_steps(&planned, base, Interruption::None, &crashed, &survivor);
    let (_survivor_db, survivor) = raw_open(&survivor);
    let resumed = run_steps(&survivor, clean, target, &accept_expected);
    if matches!(interruption, Interruption::None) {
        prop_assert_eq!(resumed, Ok(None));
    } else {
        prop_assert!(resumed.is_ok(), "resume failed: {resumed:?}");
    }
    let (_expected_db, expected) = raw_open(&expected);
    prop_assert_eq!(stored_storage_version(&survivor), i64::from(target));
    prop_assert_eq!(schema_fingerprint(&survivor), schema_fingerprint(&expected));
    prop_assert_eq!(table_rows(&survivor), table_rows(&expected));
    survivor.close().unwrap();
    expected.close().unwrap();
    Ok(())
}

#[test]
fn generated_chains_reach_the_fresh_schema_and_rows_despite_interruptions() {
    run_generated_chains(32);
}

#[test]
#[ignore = "long run for the migration proof: 1,000 generated chains"]
fn generated_chains_long_run() {
    run_generated_chains(1_000);
}

fn run_generated_chains(cases: u32) {
    let directory = tempfile::tempdir().unwrap();
    let seed = directory.path().join("seed.turso");
    block_on(async {
        let database = TursoFileDatabase::new(&seed).unwrap();
        let mut storage = database.open("scope").unwrap();
        populate(&mut storage).await;
        storage.try_close().unwrap();
    });
    let mut runner = TestRunner::new(Config {
        cases,
        failure_persistence: None,
        ..Config::default()
    });
    let strategy = proptest::collection::vec(change(), 1..6).prop_flat_map(|changes| {
        let steps = changes.len();
        (Just(changes), interruption(steps))
    });
    runner
        .run(&strategy, |(changes, interruption)| {
            check_generated_chain(&seed, &changes, interruption)
        })
        .unwrap();
}
