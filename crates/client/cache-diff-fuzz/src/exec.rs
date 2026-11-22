//! Runs a generated sequence against the host engine and records every
//! response, normalized so two builds that behave alike write the same trace.

use crate::host::engine::{EngineHandle, EntityFilterRequest, WriteRegistration, WriteRequest};
use crate::normalize::Normalizer;
use crate::sequence::{Generated, Op};
use cache_core::engine::HydrationScope;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};

mod abandon;
mod around;
mod people;

const SCOPE: &str = "diff-fuzz";
const PROBE_CHUNK: usize = 200;

#[derive(Clone)]
struct Lease {
    transaction_id: String,
    owner: String,
    generation: String,
}

/// One line of the trace: what ran and what came back.
pub struct Line {
    pub index: usize,
    pub kind: &'static str,
    pub value: Value,
}

/// What a closed run leaves: its trace, its counters, the cache file and the normalizer.
pub type Finished = (Vec<Line>, BTreeMap<String, u64>, PathBuf, Normalizer);

pub struct Exec<'a> {
    docs: &'a BTreeMap<String, String>,
    generated: &'a Generated,
    root: PathBuf,
    path: PathBuf,
    copies: usize,
    hot_capacity: Option<u32>,
    handle: Option<EngineHandle>,
    identity: String,
    normalizer: Normalizer,
    leases: HashMap<usize, Lease>,
    tx_of: HashMap<String, usize>,
    last_keys: BTreeMap<&'static str, Vec<String>>,
    /// Each live view slot's last revision and registration, as its subscriber
    /// keeps them; they outlive reopens, as a subscriber outlives the engine.
    live: BTreeMap<u8, (String, Value)>,
    pub lines: Vec<Line>,
    pub counters: BTreeMap<String, u64>,
    /// Real time to wait at `idle`, `reopen` and `crash` ops, in milliseconds (see `pause`).
    pub pause_ms: Option<u64>,
    /// Whether `idle` ops call the host's idle point directly.
    pub idle_hook: bool,
    /// Whether each hydrate is staged ahead of the op before it (see `stage_ahead`).
    pub stage_hydrates: bool,
    /// The share of hydrates run with reads issued while they run (see `check_split`).
    pub concurrent_reads: f64,
    /// Hydrates staged ahead, by op index.
    #[cfg(staged_hydrate)]
    staged: Vec<(usize, crate::host::engine::fuzz_hooks::FuzzStagedHydrate)>,
    /// Stop the first open's migration after this many steps (see `interrupt_open`).
    interrupt_migration: Option<u32>,
    /// The share of reads sent with a request id (see `abandon`).
    pub abandon_reads: f64,
    /// Operations an abandoned read registered against every change.
    broad: BTreeSet<String>,
    /// The query each operation the case registered was last registered
    /// with, for reads injected to be abandoned.
    registered: BTreeMap<String, (String, serde_json::Map<String, Value>)>,
    /// Where those operations were reported affected, as `index op`.
    broad_hits: Vec<String>,
    /// The handle a planned read runs with while it runs.
    reader: Option<EngineHandle>,
    /// Where `broad_hits` go when the run finishes.
    pub broad_out: Option<PathBuf>,
    /// The share of ops run with the next record write armed to fail (see `arm_fault`).
    pub fail_writes: f64,
    /// The share of ops run with the next record read armed to fail.
    pub fail_reads: f64,
    /// The seed that picks those ops.
    pub fault_seed: u64,
}

type Outcome = Result<Value, String>;

/// A storage failure `--fail-writes` or `--fail-reads` arms for an op.
#[derive(Clone, Copy)]
enum Fault {
    Write,
    Read,
}

impl Fault {
    fn name(self) -> &'static str {
        match self {
            Self::Write => "write",
            Self::Read => "read",
        }
    }

    #[cfg(storage_faults)]
    fn flag(self) -> &'static std::sync::atomic::AtomicBool {
        match self {
            Self::Write => &cache_turso::FUZZ_FAIL_NEXT_PUT,
            Self::Read => &cache_turso::FUZZ_FAIL_NEXT_READ,
        }
    }
}

/// A hydrate as the staging hooks take it.
#[cfg(staged_hydrate)]
pub struct HydrateRequest<'a> {
    pub query: &'a str,
    pub operation_name: Option<&'a str>,
    pub variables: &'a serde_json::Map<String, Value>,
    pub data: &'a Value,
    pub identity: Option<&'a str>,
    pub scope: Option<&'a HydrationScope>,
}

impl<'a> Exec<'a> {
    pub fn new(
        docs: &'a BTreeMap<String, String>,
        generated: &'a Generated,
        root: &Path,
        source_hashes: crate::normalize::SourceHashes,
        hot_capacity: Option<u32>,
        interrupt_migration: Option<u32>,
    ) -> Result<Self, String> {
        if interrupt_migration.is_some() && cfg!(not(migration_hooks)) {
            return Err("this build was made without MIGRATION_HOOKS=1".into());
        }
        std::fs::create_dir_all(root.join("db-0")).map_err(|error| error.to_string())?;
        let path = root.join("db-0").join("cache.turso");
        let case = serde_json::to_value(generated).map_err(|error| error.to_string())?;
        let mut inputs = case.to_string();
        // Ids derived from the case are kept too: the people index partition is a
        // UUIDv5 of the viewer, and a build that stored another one must differ.
        // Every viewer counts: the starting one and each one an op runs as.
        let mut viewers = BTreeSet::from([generated.viewer.clone()]);
        collect_identities(&case, &mut viewers);
        for viewer in viewers {
            inputs.push(' ');
            inputs.push_str(
                &uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_OID, viewer.as_bytes()).to_string(),
            );
        }
        let normalizer = Normalizer::new(&inputs, root, source_hashes);
        let mut exec = Self {
            docs,
            generated,
            root: root.to_path_buf(),
            path,
            copies: 0,
            hot_capacity,
            handle: None,
            identity: generated.viewer.clone(),
            normalizer,
            leases: HashMap::new(),
            tx_of: HashMap::new(),
            last_keys: BTreeMap::new(),
            live: BTreeMap::new(),
            lines: Vec::new(),
            counters: BTreeMap::new(),
            pause_ms: None,
            idle_hook: true,
            stage_hydrates: false,
            concurrent_reads: 0.0,
            #[cfg(staged_hydrate)]
            staged: Vec::new(),
            interrupt_migration,
            abandon_reads: 0.0,
            broad: BTreeSet::new(),
            registered: BTreeMap::new(),
            broad_hits: Vec::new(),
            reader: None,
            broad_out: None,
            fail_writes: 0.0,
            fail_reads: 0.0,
            fault_seed: 0,
        };
        exec.open(0)?;
        Ok(exec)
    }

    /// Opens the engine on the current file as the host does (`open_or_reset`),
    /// but records a reset in the trace: every case starts from an empty file,
    /// so a reset means a build could not read what it wrote.
    fn open(&mut self, index: usize) -> Result<(), String> {
        // A staged hydrate belongs to the engine that staged it, as the
        // browser host's prepared hydrate belongs to its engine.
        #[cfg(staged_hydrate)]
        self.staged.clear();
        let opened = self.interrupt_open()?;
        let database =
            cache_turso::TursoFileDatabase::new(&self.path).map_err(|error| error.to_string())?;
        let storage = match opened.unwrap_or_else(|| database.open(SCOPE)) {
            Ok(storage) => storage,
            Err(error) if error.requires_physical_reset() => {
                self.record(index, "open.reset", Err(error.to_string()));
                database
                    .physical_reset()
                    .map_err(|error| error.to_string())?;
                database.open(SCOPE).map_err(|error| error.to_string())?
            }
            Err(error) => return Err(error.to_string()),
        };
        self.handle = Some(EngineHandle::with_schema(
            storage,
            self.hot_capacity,
            cache_core::meta::bundled_schema(),
        ));
        Ok(())
    }

    /// With `--interrupt-migration-after K`, the first open runs with the
    /// storage told to fail right after committing migration step K, as a
    /// process killed there would; the open after it runs the rest. Not
    /// traced, since a file with nothing to migrate opens whole and the other
    /// side's run need not migrate: counted as `migration.interrupted` or
    /// `migration.not-interrupted`. An open the hook did not stop is returned
    /// as the open itself, so a run where it never fires opens as one without
    /// the flag. A stopped open that succeeded or asks for a reset fails the run.
    fn interrupt_open(
        &mut self,
    ) -> Result<Option<Result<cache_turso::TursoStorage, cache_turso::TursoStorageError>>, String>
    {
        let Some(steps) = self.interrupt_migration.take() else {
            return Ok(None);
        };
        #[cfg(migration_hooks)]
        {
            use cache_turso::migration_test_hooks::{interrupt_after_steps, take_interrupted};
            let database = cache_turso::TursoFileDatabase::new(&self.path)
                .map_err(|error| error.to_string())?;
            interrupt_after_steps(Some(steps));
            let opened = database.open(SCOPE);
            interrupt_after_steps(None);
            if !take_interrupted() {
                self.count("migration.not-interrupted");
                return Ok(Some(opened));
            }
            match opened {
                Ok(_) => Err("the migration hook stopped an open that succeeded".into()),
                Err(error) if error.requires_physical_reset() => Err(format!(
                    "migration interrupted after step {steps} asked for a reset: {error}"
                )),
                Err(_) => {
                    self.count("migration.interrupted");
                    Ok(None)
                }
            }
        }
        #[cfg(not(migration_hooks))]
        {
            let _ = steps;
            Ok(None)
        }
    }

    fn handle(&self) -> &EngineHandle {
        self.handle.as_ref().expect("engine is open between ops")
    }

    fn count(&mut self, name: impl Into<String>) {
        *self.counters.entry(name.into()).or_default() += 1;
    }

    fn add(&mut self, name: impl Into<String>, amount: u64) {
        *self.counters.entry(name.into()).or_default() += amount;
    }

    /// Waits `pause_ms` plus up to 30 ms in real time, so a host that
    /// checkpoints on its own once quiet for 100 ms gets to, and the op after
    /// the pause (a reopen, a crash) can land while that copy runs. The
    /// pauses during which the database file was written (a copy from the
    /// WAL: commits only append to the WAL) are counted.
    fn pause(&mut self, index: usize) {
        let Some(base) = self.pause_ms else {
            return;
        };
        let written = |path: &Path| {
            std::fs::metadata(path)
                .ok()
                .map(|metadata| (metadata.len(), metadata.modified().ok()))
        };
        let before = written(&self.path);
        std::thread::sleep(std::time::Duration::from_millis(
            base + (index as u64 * 7) % 31,
        ));
        self.count("pause");
        if written(&self.path) != before {
            self.count("pause.database-written");
        }
    }

    fn record(&mut self, index: usize, kind: &'static str, outcome: Outcome) {
        let value = match outcome {
            Ok(mut value) => {
                self.mask_broad(index, &mut value);
                value
            }
            Err(error) => {
                self.count(format!("{kind}.error"));
                json!({ "error": error })
            }
        };
        let value = self.normalizer.value(value);
        self.lines.push(Line { index, kind, value });
    }

    async fn stamped(&self) -> Result<EngineHandle, String> {
        let handle = self.handle();
        let authority = handle.current_authority(&self.identity).await?;
        Ok(handle.clone().with_generation(Some(authority.generation)))
    }

    async fn scope(&self, fenced: bool) -> Result<HydrationScope, String> {
        let handle = self.handle();
        let generation = handle.current_storage_generation().await?;
        let mut scope = HydrationScope {
            contact_fence: None,
            storage_generation: generation
                .parse()
                .map_err(|error: uuid::Error| error.to_string())?,
            identity: self.identity.clone(),
        };
        if fenced {
            let snapshot = handle
                .contact_snapshot(cache_core::people::sync::ContactSnapshotRequest {
                    scope: scope.clone(),
                    scan: None,
                })
                .await?;
            scope.contact_fence = Some(snapshot.fence);
        }
        Ok(scope)
    }

    fn doc(&self, name: &str) -> Result<String, String> {
        self.docs
            .get(name)
            .cloned()
            .ok_or_else(|| format!("no document {name}"))
    }

    pub async fn run(&mut self) -> Result<(), String> {
        let ops = self.generated.ops.clone();
        if self.stage_hydrates && cfg!(not(staged_hydrate)) {
            return Err("this build was made without STAGED_HYDRATE=1".into());
        }
        if (self.fail_writes > 0.0 || self.fail_reads > 0.0) && cfg!(not(storage_faults)) {
            return Err("this build was made without STORAGE_FAULTS=1".into());
        }
        for (index, op) in ops.iter().enumerate() {
            #[cfg(staged_hydrate)]
            if self.stage_hydrates
                && let Some(next) = ops.get(index + 1)
            {
                self.stage_ahead(index + 1, next).await;
            }
            let write = self.arm_fault(index, Fault::Write);
            let read = self.arm_fault(index, Fault::Read);
            let stepped = self.step(index, op).await;
            if write {
                self.disarm_fault(Fault::Write);
            }
            if read {
                self.disarm_fault(Fault::Read);
            }
            stepped?;
        }
        Ok(())
    }

    /// With `--fail-writes SHARE` (`--fail-reads SHARE`), arms the next record write
    /// (batch of record reads) to fail for that share of ops. The pick hashes the seed,
    /// the op index and the kind of fault, drawing nothing from the case.
    fn arm_fault(&mut self, index: usize, fault: Fault) -> bool {
        let (share, salt) = match fault {
            Fault::Write => (self.fail_writes, 0),
            Fault::Read => (self.fail_reads, 0x5851_f42d_4c95_7f2d),
        };
        if share <= 0.0 {
            return false;
        }
        let mut mixed =
            self.fault_seed ^ salt ^ (index as u64 + 1).wrapping_mul(0x9e37_79b9_7f4a_7c15);
        mixed = (mixed ^ (mixed >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        mixed = (mixed ^ (mixed >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        mixed ^= mixed >> 31;
        if (mixed % 1_000) as f64 >= share * 1_000.0 {
            return false;
        }
        #[cfg(storage_faults)]
        fault.flag().store(true, std::sync::atomic::Ordering::SeqCst);
        self.count(format!("fault.{}.armed", fault.name()));
        true
    }

    /// Disarms what `arm_fault` armed, counting whether a write or read took it.
    fn disarm_fault(&mut self, fault: Fault) {
        #[cfg(storage_faults)]
        if !fault.flag().swap(false, std::sync::atomic::Ordering::SeqCst) {
            self.count(format!("fault.{}.fired", fault.name()));
        }
        #[cfg(not(storage_faults))]
        let _ = fault;
    }

    pub async fn step(&mut self, index: usize, op: &Op) -> Result<(), String> {
        match op {
            Op::Hydrate {
                lane,
                doc,
                variables,
                data,
                identity,
                contacts,
            } => {
                self.inject_abandoned(index).await?;
                self.identity.clone_from(identity);
                self.count(format!("hydrate.{lane}"));
                let split = self.split_due(index);
                let before = match split {
                    true => Some(self.split_reads(doc, variables).await?),
                    false => None,
                };
                let during = before
                    .as_ref()
                    .map(|_| self.spawn_split_reads(doc, variables));
                let outcome = self.hydrate(index, doc, variables, data, *contacts).await;
                let returned = std::time::Instant::now();
                if let (Some(before), Some(during)) = (before, during) {
                    self.check_split(index, doc, variables, before, during, returned)
                        .await?;
                }
                if let Ok(value) = &outcome {
                    if value["writeResult"]["revisionAdvanced"] == json!(false) {
                        self.count("hydrate.revision-unchanged");
                    }
                    if value["unchangedViews"]
                        .as_array()
                        .is_some_and(|views| !views.is_empty())
                    {
                        self.count("hydrate.unchanged-views");
                    }
                }
                self.record(index, "hydrate", outcome);
            }
            Op::Write {
                lane,
                doc,
                variables,
                data,
                identity,
                register,
            } => {
                self.inject_abandoned(index).await?;
                self.identity.clone_from(identity);
                self.count(format!("write.{lane}"));
                self.note_registration(register.as_ref(), doc, variables);
                let outcome = self.write(doc, variables, data, register.clone()).await;
                // Its own affectedOps come before it registers the operation
                // again, as a read's does: on both sides alike from then on.
                let registered = outcome.is_ok();
                self.record(index, "write", outcome);
                self.read_registered(register.as_ref(), registered);
            }
            Op::Read {
                doc,
                variables,
                register,
            } => {
                self.note_registration(register.as_ref(), doc, variables);
                if let Some(plan) = self.abandon_plan(index, true) {
                    return self
                        .abandon_read_op(index, plan, doc, variables, register.as_ref())
                        .await;
                }
                let outcome = async {
                    let result = self
                        .handle()
                        .read(
                            register.clone(),
                            self.doc(doc)?,
                            Some(doc.clone()),
                            variables.clone(),
                            vec![],
                        )
                        .await?;
                    serde_json::to_value(result).map_err(|error| error.to_string())
                }
                .await;
                if let Ok(value) = &outcome {
                    let kind = value["kind"].as_str().unwrap_or("?").to_owned();
                    self.count(format!("read.{kind}"));
                }
                self.read_registered(register.as_ref(), outcome.is_ok());
                self.record(index, "read", outcome);
            }
            Op::Teardown { op_id } => {
                self.broad.remove(op_id);
                self.registered.remove(op_id);
                let outcome = self
                    .handle()
                    .teardown(op_id.clone())
                    .await
                    .map(|()| Value::Null);
                self.record(index, "teardown", outcome);
            }
            Op::ReadKeys { fragment, keys } => {
                let keys = match keys {
                    Some(keys) => keys.clone(),
                    None => self.last_keys.get("filter").cloned().unwrap_or_default(),
                };
                self.add("read-keys.keys", keys.len() as u64);
                let plan = self.abandon_plan(index, false);
                let id = match plan {
                    Some(plan) => self.plan_reader(index, plan)?,
                    None => None,
                };
                let mut outcome = self.read_keys(fragment, keys).await;
                if let Some(plan) = plan {
                    outcome = self.end_planned(index, plan, id, outcome)?;
                }
                self.record(index, "read-keys", outcome);
            }
            Op::Filter { request, pages } => {
                let plan = self.abandon_plan(index, false);
                let id = match plan {
                    Some(plan) => self.plan_reader(index, plan)?,
                    None => None,
                };
                // An abandoned filter's keys never reached its caller.
                let keys = self.last_keys.get("filter").cloned();
                let mut outcome = self.filter(request, *pages).await;
                if let Some(plan) = plan {
                    outcome = self.end_planned(index, plan, id, outcome)?;
                    if plan.masks() {
                        match keys {
                            Some(keys) => self.last_keys.insert("filter", keys),
                            None => self.last_keys.remove("filter"),
                        };
                    }
                }
                self.record(index, "filter", outcome);
            }
            Op::Live {
                slot,
                action,
                request,
            } => {
                let outcome = self.live(*slot, action, request).await;
                self.record(index, "live", outcome);
            }
            Op::Search { request, pages } => {
                let plan = self.abandon_plan(index, false);
                let id = match plan {
                    Some(plan) => self.plan_reader(index, plan)?,
                    None => None,
                };
                let mut outcome = self.search(request, *pages).await;
                if let Some(plan) = plan {
                    outcome = self.end_planned(index, plan, id, outcome)?;
                }
                self.record(index, "search", outcome);
            }
            Op::Enqueue {
                tx,
                uuid,
                doc,
                variables,
                data,
                created_at_ms,
                owner,
                now_ms,
                lease_ms,
            } => {
                let outcome = async {
                    let handle = self.stamped().await?;
                    let result = handle
                        .enqueue_optimistic_mutation(
                            None,
                            uuid.clone(),
                            self.doc(doc)?,
                            Some(doc.clone()),
                            variables.clone(),
                            data.clone(),
                            vec![],
                            vec![],
                            vec![],
                            *created_at_ms,
                            owner.clone(),
                            *now_ms,
                            now_ms + lease_ms,
                            None,
                            vec![],
                        )
                        .await?;
                    serde_json::to_value(result).map_err(|error| error.to_string())
                }
                .await;
                if let Ok(value) = &outcome {
                    if let Some(id) = value["transactionId"].as_str() {
                        self.tx_of.insert(id.to_owned(), *tx);
                    }
                    let kind = value["upsertKind"]["kind"]
                        .as_str()
                        .or_else(|| value["upsertKind"].as_str())
                        .unwrap_or("?")
                        .to_owned();
                    self.count(format!("enqueue.{kind}"));
                    self.learn_leases(value, owner);
                }
                self.record(index, "enqueue", outcome);
            }
            Op::Claim {
                owner,
                now_ms,
                lease_ms,
            } => {
                let outcome = async {
                    let result = self
                        .handle()
                        .claim_next_mutation(owner.clone(), *now_ms, now_ms + lease_ms)
                        .await?;
                    serde_json::to_value(result).map_err(|error| error.to_string())
                }
                .await;
                if let Ok(value) = &outcome {
                    self.count(if value.is_null() {
                        "claim.none"
                    } else {
                        "claim.some"
                    });
                    self.learn_leases(value, owner);
                }
                self.record(index, "claim", outcome);
            }
            Op::Commit {
                tx,
                doc,
                variables,
                data,
            } => {
                let lease = self.lease(*tx);
                let outcome = async {
                    let handle = self.stamped().await?;
                    let result = handle
                        .commit_optimistic_write(
                            lease.transaction_id,
                            lease.owner,
                            lease.generation,
                            self.doc(doc)?,
                            Some(doc.clone()),
                            variables.clone(),
                            data.clone(),
                        )
                        .await?;
                    serde_json::to_value(result).map_err(|error| error.to_string())
                }
                .await;
                self.settled(*tx, "commit", &outcome);
                self.record(index, "commit", outcome);
            }
            Op::Rollback { tx } => {
                let lease = self.lease(*tx);
                let outcome = async {
                    let result = self
                        .handle()
                        .rollback_optimistic_write(
                            lease.transaction_id,
                            lease.owner,
                            lease.generation,
                        )
                        .await?;
                    serde_json::to_value(result).map_err(|error| error.to_string())
                }
                .await;
                self.settled(*tx, "rollback", &outcome);
                self.record(index, "rollback", outcome);
            }
            Op::Defer {
                tx,
                next_attempt_at_ms,
                server_failure,
            } => {
                let lease = self.lease(*tx);
                let outcome = async {
                    let result = self
                        .handle()
                        .defer_optimistic_write(
                            lease.transaction_id,
                            lease.owner,
                            lease.generation,
                            *next_attempt_at_ms,
                            "fuzz".into(),
                            *server_failure,
                        )
                        .await?;
                    serde_json::to_value(result).map_err(|error| error.to_string())
                }
                .await;
                self.settled(*tx, "defer", &outcome);
                self.record(index, "defer", outcome);
            }
            Op::InspectMutations => {
                let outcome = async {
                    let result = self.handle().inspect_mutations().await?;
                    serde_json::to_value(result).map_err(|error| error.to_string())
                }
                .await;
                self.record(index, "inspect", outcome);
            }
            Op::Delete { keys } => {
                let outcome = async {
                    let result = self.handle().delete_records(keys.clone()).await?;
                    serde_json::to_value(result).map_err(|error| error.to_string())
                }
                .await;
                self.record(index, "delete", outcome);
            }
            Op::Invalidate { keys } => {
                let outcome = async {
                    let result = self.handle().invalidate(keys.clone()).await?;
                    serde_json::to_value(result).map_err(|error| error.to_string())
                }
                .await;
                self.record(index, "invalidate", outcome);
            }
            Op::ContactReconcile {
                identity,
                keep_every,
            } => {
                self.identity.clone_from(identity);
                let outcome = self.contact_reconcile(*keep_every).await;
                self.record(index, "contact-reconcile", outcome);
            }
            Op::PeopleContext { identity, epoch } => {
                self.identity.clone_from(identity);
                let outcome = self.people_context(epoch).await;
                self.record(index, "people-context", outcome);
            }
            Op::PeopleSearch {
                identity,
                request,
                pages,
            } => {
                self.identity.clone_from(identity);
                let outcome = self.people_search(request, *pages).await;
                self.record(index, "people-search", outcome);
            }
            Op::PeopleReferences { identity, request } => {
                self.identity.clone_from(identity);
                let outcome = self.people_references(request).await;
                self.record(index, "people-references", outcome);
            }
            Op::Clear => {
                let outcome = self
                    .handle()
                    .clear()
                    .await
                    .map(|revision| json!(revision.to_string()));
                // A clear drops every registration.
                if outcome.is_ok() {
                    self.broad.clear();
                }
                self.record(index, "clear", outcome);
            }
            Op::Idle => {
                // Builds differ here by design: only the idle checkpoint build
                // checkpoints. What it did is counted, not compared; a failed
                // checkpoint fails the seed.
                self.pause(index);
                if !self.idle_hook {
                    return Ok(());
                }
                if let Some(checkpoint) = self.handle().fuzz_idle().await {
                    let (ran, backfilled) = checkpoint?;
                    if ran {
                        self.count("idle.checkpoint");
                        self.add("idle.checkpoint.frames", backfilled);
                    } else {
                        self.count("idle.not-due");
                    }
                }
            }
            Op::Reopen => {
                self.count("reopen");
                self.pause(index);
                let handle = self.handle.take().ok_or("engine is closed")?;
                handle.shutdown()?;
                // A new engine starts with no operations registered.
                self.broad.clear();
                self.open(index)?;
            }
            Op::Crash => {
                self.count("crash");
                self.pause(index);
                self.copies += 1;
                let from = self.path.parent().expect("db dir").to_path_buf();
                let to = self.root.join(format!("db-{}", self.copies));
                copy_dir(&from, &to)?;
                // The old engine is abandoned as it is: nothing it does after
                // the copy reaches the files the next engine opens.
                drop(self.handle.take());
                self.broad.clear();
                self.path = to.join("cache.turso");
                self.open(index)?;
            }
            Op::Probe => self.probe(index).await,
        }
        Ok(())
    }

    fn learn_leases(&mut self, value: &Value, owner: &str) {
        let mut found = Vec::new();
        collect_leases(value, &mut found);
        for (id, generation) in found {
            if let Some(tx) = self.tx_of.get(&id).copied() {
                self.leases.insert(
                    tx,
                    Lease {
                        transaction_id: id,
                        owner: owner.to_owned(),
                        generation,
                    },
                );
            }
        }
    }

    fn lease(&mut self, tx: usize) -> Lease {
        match self.leases.get(&tx).cloned() {
            Some(lease) => {
                self.count("settle.with-lease");
                lease
            }
            None => {
                self.count("settle.without-lease");
                let transaction_id = self
                    .tx_of
                    .iter()
                    .filter(|(_, index)| **index == tx)
                    .map(|(id, _)| id.clone())
                    .max()
                    .unwrap_or_else(|| "0".into());
                Lease {
                    transaction_id,
                    owner: "runner-a".into(),
                    generation: "0".into(),
                }
            }
        }
    }

    fn settled(&mut self, tx: usize, kind: &str, outcome: &Outcome) {
        if let Ok(value) = outcome {
            let tag = value["kind"].as_str().unwrap_or("?").to_owned();
            self.count(format!("{kind}.{tag}"));
            if let Some(id) = value["replacementTransactionId"].as_str() {
                self.tx_of.insert(id.to_owned(), tx);
                self.leases.remove(&tx);
            }
        }
    }

    async fn hydrate(
        &mut self,
        index: usize,
        doc: &str,
        variables: &serde_json::Map<String, Value>,
        data: &Value,
        contacts: bool,
    ) -> Outcome {
        let handle = self.stamped().await?;
        let scope = if contacts {
            Some(self.scope(true).await?)
        } else {
            None
        };
        #[cfg(staged_hydrate)]
        let staged = self
            .staged
            .iter()
            .position(|(at, _)| *at == index)
            .map(|at| self.staged.remove(at).1);
        #[cfg(staged_hydrate)]
        if let Some(staged) = staged {
            match handle.fuzz_commit_staged_hydrate(staged).await {
                Some(result) => {
                    self.count(match result.is_ok() {
                        true => "stage.committed",
                        false => "stage.commit-error",
                    });
                    let result = result?;
                    return Ok(json!({
                        "unchangedViews": result.unchanged_views,
                        "searchChangedBuckets": result.search_changed_buckets,
                        "writeResult": serde_json::to_value(result.write_result).map_err(|error| error.to_string())?,
                        "data": result.data,
                    }));
                }
                None => self.count("stage.whole-at-commit"),
            }
        }
        #[cfg(not(staged_hydrate))]
        let _ = index;
        let result = handle
            .hydrate_query(
                self.doc(doc)?,
                Some(doc.to_owned()),
                variables.clone(),
                data.clone(),
                Some(self.identity.clone()),
                scope,
            )
            .await?;
        Ok(json!({
            "unchangedViews": result.unchanged_views,
            "searchChangedBuckets": result.search_changed_buckets,
            "writeResult": serde_json::to_value(result.write_result).map_err(|error| error.to_string())?,
            "data": result.data,
        }))
    }

    async fn write(
        &mut self,
        doc: &str,
        variables: &serde_json::Map<String, Value>,
        data: &Value,
        register: Option<String>,
    ) -> Outcome {
        let handle = self.stamped().await?;
        let result = handle
            .write(WriteRequest {
                origin_op_id: None,
                registration: register.map(|op_id| WriteRegistration {
                    op_id,
                    entity_resolvers: vec![],
                }),
                query: self.doc(doc)?,
                operation_name: Some(doc.to_owned()),
                variables: variables.clone(),
                data: data.clone(),
                identity: Some(self.identity.clone()),
            })
            .await?;
        serde_json::to_value(result).map_err(|error| error.to_string())
    }

    async fn read_keys(&mut self, fragment: &str, keys: Vec<String>) -> Outcome {
        let document = self.doc(&format!("fragment:{fragment}"))?;
        let result = self
            .reader()
            .read_records_by_keys(document, fragment.to_owned(), keys)
            .await?;
        serde_json::to_value(result).map_err(|error| error.to_string())
    }

    async fn filter(&mut self, request: &Value, pages: u8) -> Outcome {
        let mut request = request.clone();
        let mail = request.get("mail").is_some();
        let mut out = Vec::new();
        let mut keys = Vec::new();
        for page in 0..pages {
            let parsed: EntityFilterRequest = serde_json::from_value(request.clone())
                .map_err(|error| format!("request: {error}"))?;
            let result = self.reader().entity_filter(parsed).await;
            let value = match result {
                Ok(result) => serde_json::to_value(result).map_err(|error| error.to_string())?,
                Err(error) => {
                    self.count("filter.error");
                    out.push(json!({ "error": error }));
                    break;
                }
            };
            let kind = value["kind"].as_str().unwrap_or("?").to_owned();
            self.count(format!(
                "filter.{}.{kind}",
                if mail { "mail" } else { "soup" }
            ));
            if value["optimistic"] == json!(true) {
                self.count("filter.optimistic");
            }
            if let Some(page_keys) = value["keys"].as_array() {
                self.add("filter.keys", page_keys.len() as u64);
                keys.extend(
                    page_keys
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned),
                );
            }
            if page > 0 {
                self.count("filter.mail.next-page");
            }
            let next = value["nextCursor"].as_str().map(str::to_owned);
            out.push(value);
            match next {
                Some(cursor) if mail => request["mail"]["cursor"] = json!(cursor),
                _ => break,
            }
        }
        self.last_keys.insert("filter", keys);
        Ok(json!({ "request": request, "pages": out }))
    }

    /// One live view op (see `Op::Live`). The slot's revision and registration
    /// are this run's own, so they are sent as they are, never normalized.
    async fn live(&mut self, slot: u8, action: &str, request: &Value) -> Outcome {
        const FRAGMENT: &str = "SoupItemFields";
        let id = format!("live-{slot}");
        self.count(format!("live.{action}"));
        let value = if action == "resume" {
            let Some((since, registration)) = self.live.get(&slot).cloned() else {
                self.count("live.resume-unregistered");
                return Ok(json!("unregistered"));
            };
            let registration =
                serde_json::from_value(registration).map_err(|error| error.to_string())?;
            let result = self
                .handle()
                .resume_entity_filter(id, registration, Some(since))
                .await?;
            serde_json::to_value(result).map_err(|error| error.to_string())?
        } else {
            let since = match action {
                "read-since" => self.live.get(&slot).map(|(since, _)| since.clone()),
                _ => None,
            };
            let mut request = request.clone();
            request["liveQuery"] = json!({
                "id": id,
                "document": self.doc(&format!("fragment:{FRAGMENT}"))?,
                "fragmentName": FRAGMENT,
                "since": since,
                "release": action == "release",
            });
            let parsed: EntityFilterRequest =
                serde_json::from_value(request).map_err(|error| format!("request: {error}"))?;
            let result = self.handle().entity_filter(parsed).await?;
            serde_json::to_value(result).map_err(|error| error.to_string())?
        };
        if action == "release" {
            self.live.remove(&slot);
        }
        if value["kind"] == json!("live-query") {
            for (field, counter) in [("reset", "live.reset"), ("optimistic", "live.optimistic")] {
                if value[field] == json!(true) {
                    self.count(counter);
                }
            }
            for field in ["upserts", "patches", "removed"] {
                let len = value[field].as_array().map_or(0, Vec::len);
                self.add(format!("live.{field}"), len as u64);
            }
            if let (Some(revision), registration) =
                (value["revision"].as_str(), &value["registrationId"])
            {
                self.live
                    .insert(slot, (revision.to_owned(), registration.clone()));
            }
        } else if action == "resume" {
            self.count("live.resume-gone");
        }
        Ok(value)
    }

    async fn search(&mut self, request: &Value, pages: u8) -> Outcome {
        let mut request = request.clone();
        let mut out = Vec::new();
        for _ in 0..pages {
            let parsed: cache_core::search::SearchRequest = serde_json::from_value(request.clone())
                .map_err(|error| format!("request: {error}"))?;
            let value = match self.reader().search(parsed).await {
                Ok(page) => serde_json::to_value(page).map_err(|error| error.to_string())?,
                Err(error) => {
                    self.count("search.error");
                    out.push(json!({ "error": error }));
                    break;
                }
            };
            self.count("search.page");
            if request["query"].as_str().is_some_and(str::is_empty) {
                self.count("search.browse");
            } else {
                self.count("search.typed");
            }
            let next = value["nextCursor"].clone();
            out.push(value);
            if next.is_null() {
                break;
            }
            request["cursor"] = next;
        }
        Ok(Value::Array(out))
    }

    /// Reads everything the sequence could have written, in a fixed order.
    async fn probe(&mut self, index: usize) {
        self.count("probe");
        let fragments: Vec<(String, Vec<String>)> = self
            .generated
            .probe_keys
            .iter()
            .map(|(fragment, keys)| (fragment.clone(), keys.clone()))
            .collect();
        for (fragment, keys) in fragments {
            for chunk in keys.chunks(PROBE_CHUNK) {
                let outcome = self.read_keys(&fragment, chunk.to_vec()).await;
                self.record(index, "probe.keys", outcome);
            }
        }
        for request in crate::probe::filters() {
            let pages = if request.get("mail").is_some() {
                200
            } else {
                1
            };
            let outcome = self.filter(&request, pages).await;
            self.record(index, "probe.filter", outcome);
        }
        for request in crate::probe::searches() {
            let outcome = self.search(&request, 3).await;
            self.record(index, "probe.search", outcome);
        }
        let outcome = async {
            let result = self.handle().inspect_mutations().await?;
            serde_json::to_value(result).map_err(|error| error.to_string())
        }
        .await;
        self.record(index, "probe.mutations", outcome);
        for request in crate::probe::people() {
            let outcome = self.people_search(&request, 2).await;
            self.record(index, "probe.people", outcome);
        }
    }

    /// Closes the engine and dumps every table of the file it leaves behind.
    pub fn finish(mut self) -> Result<Finished, String> {
        let handle = self.handle.take().ok_or("engine is closed")?;
        handle.shutdown()?;
        if let Some(out) = &self.broad_out {
            let hits: String = self
                .broad_hits
                .iter()
                .map(|hit| format!("{hit}\n"))
                .collect();
            std::fs::write(out, hits).map_err(|error| error.to_string())?;
        }
        Ok((self.lines, self.counters, self.path, self.normalizer))
    }
}

/// Every string under an `identity` key: the viewers the case's ops run as.
fn collect_identities(value: &Value, found: &mut BTreeSet<String>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                match (key.as_str(), child) {
                    ("identity", Value::String(identity)) => {
                        found.insert(identity.clone());
                    }
                    _ => collect_identities(child, found),
                }
            }
        }
        Value::Array(items) => items
            .iter()
            .for_each(|item| collect_identities(item, found)),
        _ => {}
    }
}

fn collect_leases(value: &Value, found: &mut Vec<(String, String)>) {
    match value {
        Value::Object(map) => {
            if let (Some(Value::String(id)), Some(Value::String(generation))) =
                (map.get("transactionId"), map.get("leaseGeneration"))
            {
                found.push((id.clone(), generation.clone()));
            }
            for child in map.values() {
                collect_leases(child, found);
            }
        }
        Value::Array(items) => items.iter().for_each(|item| collect_leases(item, found)),
        _ => {}
    }
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|error| error.to_string())?;
    let mut entries = std::fs::read_dir(from)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    // The WAL before the database file: a checkpoint copying meanwhile then
    // leaves a database ahead of a WAL that still holds every frame it copied,
    // as a crash would, never a WAL restarted past a database that missed it.
    entries.sort_by_key(|entry| !entry.file_name().to_string_lossy().ends_with("-wal"));
    for entry in entries {
        if entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            std::fs::copy(entry.path(), to.join(entry.file_name()))
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}
