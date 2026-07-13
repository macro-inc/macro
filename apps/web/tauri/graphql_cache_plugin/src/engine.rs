//! Dedicated engine thread owning the cache engine + SQLite storage.
//!
//! `cache-core` futures are deliberately `?Send` (the `Storage` trait must
//! be implementable by wasm backends), so the engine cannot be shared behind
//! an async mutex on the tokio runtime. Instead one OS thread owns it and
//! executes each command with `pollster::block_on` — the SQLite storage
//! completes immediately; blocking IO is the point of the native host (see
//! `cache-sqlite`). The channel serializes commands the same way the browser
//! worker's queue + async mutex do.
//!
//! Operation ids cross the IPC boundary as strings (`"{clientId}:{urqlKey}"`)
//! so multiple webviews can register operations against the one shared
//! engine without collisions; they're interned to the engine's `u64` ids
//! internally — the same scheme as the `cache-wasm` shell.

use cache_core::deps::OpId;
use cache_core::engine::{Engine, ReadResult, WriteResult};
use cache_core::value::EntityKey;
use cache_sqlite::SqliteStorage;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::mpsc;
use tokio::sync::oneshot;

/// Mirrors `ReadResult` in `apps/web/src/lib/graphql-cache/protocol.ts`.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReadResultWire {
    /// Fully answerable from cache.
    Hit {
        /// Denormalized response data.
        data: serde_json::Value,
    },
    /// Not answerable; the exchange forwards to the network.
    Miss,
}

/// Mirrors `WriteResult` in `apps/web/src/lib/graphql-cache/protocol.ts`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResultWire {
    /// Entity keys whose records changed.
    pub changed: Vec<String>,
    /// Registered operation ids affected by the change (origin excluded).
    pub affected_ops: Vec<String>,
    /// True when the identity witness wiped and rebound the cache before
    /// this write (silent restart).
    pub reset: bool,
}

/// Mirrors `OptimisticWriteResult` in
/// `apps/web/src/lib/graphql-cache/protocol.ts`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimisticWriteResultWire {
    /// Engine-assigned id; settle with commit/rollback. A string because JS
    /// numbers lose precision past 2^53 (same as the wasm shell).
    pub transaction_id: String,
    /// Visible (composed-view) changes — nothing is durable until commit.
    #[serde(flatten)]
    pub result: WriteResultWire,
}

/// Interns host-side string operation ids to engine `u64` ids.
#[derive(Default)]
struct OpInterner {
    by_name: HashMap<String, OpId>,
    by_id: HashMap<OpId, String>,
    next: OpId,
}

impl OpInterner {
    fn intern(&mut self, name: &str) -> OpId {
        if let Some(id) = self.by_name.get(name) {
            return *id;
        }
        self.next += 1;
        let id = self.next;
        self.by_name.insert(name.to_string(), id);
        self.by_id.insert(id, name.to_string());
        id
    }

    fn remove(&mut self, name: &str) -> Option<OpId> {
        let id = self.by_name.remove(name)?;
        self.by_id.remove(&id);
        Some(id)
    }

    fn names(&self, ids: impl IntoIterator<Item = OpId>) -> Vec<String> {
        ids.into_iter()
            .filter_map(|id| self.by_id.get(&id).cloned())
            .collect()
    }
}

type Variables = serde_json::Map<String, serde_json::Value>;
type Reply<T> = oneshot::Sender<Result<T, String>>;

enum Command {
    Read {
        op_id: Option<String>,
        query: String,
        operation_name: Option<String>,
        variables: Variables,
        reply: Reply<ReadResultWire>,
    },
    Write {
        origin_op_id: Option<String>,
        query: String,
        operation_name: Option<String>,
        variables: Variables,
        data: serde_json::Value,
        identity: Option<String>,
        reply: Reply<WriteResultWire>,
    },
    BeginOptimisticWrite {
        origin_op_id: Option<String>,
        query: String,
        operation_name: Option<String>,
        variables: Variables,
        data: serde_json::Value,
        reply: Reply<OptimisticWriteResultWire>,
    },
    CommitOptimisticWrite {
        transaction_id: String,
        query: String,
        operation_name: Option<String>,
        variables: Variables,
        data: serde_json::Value,
        reply: Reply<WriteResultWire>,
    },
    RollbackOptimisticWrite {
        transaction_id: String,
        reply: Reply<WriteResultWire>,
    },
    Invalidate {
        keys: Vec<String>,
        reply: Reply<Vec<String>>,
    },
    Teardown {
        op_id: String,
        reply: Reply<()>,
    },
    Clear {
        reply: Reply<()>,
    },
}

/// Cheaply-clonable handle to the engine thread. All methods serialize onto
/// that thread; errors are stringified for the IPC boundary (the JS host
/// rejects the pending call, and the exchange degrades to the network).
#[derive(Clone)]
pub struct EngineHandle {
    tx: mpsc::Sender<Command>,
}

impl EngineHandle {
    /// Spawns the engine thread over an opened storage backend.
    /// A `hot_capacity` of 0 is treated as unset (engine default).
    pub fn spawn(
        storage: SqliteStorage,
        hot_capacity: Option<u32>,
    ) -> Result<Self, std::io::Error> {
        let engine = match hot_capacity.filter(|c| *c > 0) {
            Some(cap) => Engine::with_capacity(storage, cap as usize),
            None => Engine::new(storage),
        };
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("graphql-cache-engine".into())
            .spawn(move || run(engine, rx))?;
        Ok(EngineHandle { tx })
    }

    async fn request<T>(&self, build: impl FnOnce(Reply<T>) -> Command) -> Result<T, String> {
        let (reply, rx) = oneshot::channel();
        self.tx
            .send(build(reply))
            .map_err(|_| "graphql cache engine thread is gone".to_string())?;
        rx.await
            .map_err(|_| "graphql cache engine thread dropped the request".to_string())?
    }

    /// Cache read; registers `op_id` as active when given.
    pub async fn read(
        &self,
        op_id: Option<String>,
        query: String,
        operation_name: Option<String>,
        variables: Variables,
    ) -> Result<ReadResultWire, String> {
        self.request(|reply| Command::Read {
            op_id,
            query,
            operation_name,
            variables,
            reply,
        })
        .await
    }

    /// Normalizes and stores a network response.
    pub async fn write(
        &self,
        origin_op_id: Option<String>,
        query: String,
        operation_name: Option<String>,
        variables: Variables,
        data: serde_json::Value,
        identity: Option<String>,
    ) -> Result<WriteResultWire, String> {
        self.request(|reply| Command::Write {
            origin_op_id,
            query,
            operation_name,
            variables,
            data,
            identity,
            reply,
        })
        .await
    }

    /// Installs an in-memory optimistic layer (persists nothing).
    pub async fn begin_optimistic_write(
        &self,
        origin_op_id: Option<String>,
        query: String,
        operation_name: Option<String>,
        variables: Variables,
        data: serde_json::Value,
    ) -> Result<OptimisticWriteResultWire, String> {
        self.request(|reply| Command::BeginOptimisticWrite {
            origin_op_id,
            query,
            operation_name,
            variables,
            data,
            reply,
        })
        .await
    }

    /// Replaces a pending optimistic layer with the real network response.
    pub async fn commit_optimistic_write(
        &self,
        transaction_id: String,
        query: String,
        operation_name: Option<String>,
        variables: Variables,
        data: serde_json::Value,
    ) -> Result<WriteResultWire, String> {
        self.request(|reply| Command::CommitOptimisticWrite {
            transaction_id,
            query,
            operation_name,
            variables,
            data,
            reply,
        })
        .await
    }

    /// Drops a pending optimistic layer's contribution (mutation failed).
    pub async fn rollback_optimistic_write(
        &self,
        transaction_id: String,
    ) -> Result<WriteResultWire, String> {
        self.request(|reply| Command::RollbackOptimisticWrite {
            transaction_id,
            reply,
        })
        .await
    }

    /// Evicts records by entity key; returns the affected registered op ids.
    pub async fn invalidate(&self, keys: Vec<String>) -> Result<Vec<String>, String> {
        self.request(|reply| Command::Invalidate { keys, reply })
            .await
    }

    /// Unregisters an operation (urql teardown).
    pub async fn teardown(&self, op_id: String) -> Result<(), String> {
        self.request(|reply| Command::Teardown { op_id, reply })
            .await
    }

    /// Drops all cached state (logout).
    pub async fn clear(&self) -> Result<(), String> {
        self.request(|reply| Command::Clear { reply }).await
    }
}

fn wire_write_result(ops: &OpInterner, result: WriteResult) -> WriteResultWire {
    WriteResultWire {
        changed: result.changed.into_iter().map(|k| k.0).collect(),
        affected_ops: ops.names(result.affected_ops),
        reset: result.reset,
    }
}

fn parse_transaction_id(id: &str) -> Result<u64, String> {
    id.parse::<u64>()
        .map_err(|_| format!("invalid optimistic transaction id `{id}`"))
}

fn run(mut engine: Engine<SqliteStorage>, rx: mpsc::Receiver<Command>) {
    let mut ops = OpInterner::default();
    // Ends when the last handle drops (app shutdown).
    while let Ok(command) = rx.recv() {
        handle_command(&mut engine, &mut ops, command);
    }
}

fn handle_command(engine: &mut Engine<SqliteStorage>, ops: &mut OpInterner, command: Command) {
    // Replies to dropped receivers (e.g. a closed webview) are discarded.
    match command {
        Command::Read {
            op_id,
            query,
            operation_name,
            variables,
            reply,
        } => {
            let op = op_id.map(|name| ops.intern(&name));
            let result = pollster::block_on(engine.read_query(
                op,
                &query,
                operation_name.as_deref(),
                &variables,
            ))
            .map(|result| match result {
                ReadResult::Hit { data } => ReadResultWire::Hit { data },
                ReadResult::Miss => ReadResultWire::Miss,
            })
            .map_err(|e| e.to_string());
            let _ = reply.send(result);
        }
        Command::Write {
            origin_op_id,
            query,
            operation_name,
            variables,
            data,
            identity,
            reply,
        } => {
            let origin = origin_op_id.map(|name| ops.intern(&name));
            let result = pollster::block_on(engine.write_query(
                origin,
                &query,
                operation_name.as_deref(),
                &variables,
                &data,
                identity.as_deref(),
            ))
            .map(|result| wire_write_result(ops, result))
            .map_err(|e| e.to_string());
            let _ = reply.send(result);
        }
        Command::BeginOptimisticWrite {
            origin_op_id,
            query,
            operation_name,
            variables,
            data,
            reply,
        } => {
            let origin = origin_op_id.map(|name| ops.intern(&name));
            let result = pollster::block_on(engine.begin_optimistic_write(
                origin,
                &query,
                operation_name.as_deref(),
                &variables,
                &data,
            ))
            .map(|(transaction, result)| OptimisticWriteResultWire {
                transaction_id: transaction.to_string(),
                result: wire_write_result(ops, result),
            })
            .map_err(|e| e.to_string());
            let _ = reply.send(result);
        }
        Command::CommitOptimisticWrite {
            transaction_id,
            query,
            operation_name,
            variables,
            data,
            reply,
        } => {
            let result = parse_transaction_id(&transaction_id).and_then(|transaction| {
                pollster::block_on(engine.commit_optimistic_write(
                    transaction,
                    &query,
                    operation_name.as_deref(),
                    &variables,
                    &data,
                ))
                .map(|result| wire_write_result(ops, result))
                .map_err(|e| e.to_string())
            });
            let _ = reply.send(result);
        }
        Command::RollbackOptimisticWrite {
            transaction_id,
            reply,
        } => {
            let result = parse_transaction_id(&transaction_id).and_then(|transaction| {
                pollster::block_on(engine.rollback_optimistic_write(transaction))
                    .map(|result| wire_write_result(ops, result))
                    .map_err(|e| e.to_string())
            });
            let _ = reply.send(result);
        }
        Command::Invalidate { keys, reply } => {
            let keys: Vec<EntityKey> = keys.into_iter().map(EntityKey).collect();
            let affected = engine.invalidate_keys(keys.iter());
            let _ = reply.send(Ok(ops.names(affected)));
        }
        Command::Teardown { op_id, reply } => {
            if let Some(id) = ops.remove(&op_id) {
                engine.teardown_operation(id);
            }
            let _ = reply.send(Ok(()));
        }
        Command::Clear { reply } => {
            let result = pollster::block_on(engine.clear()).map_err(|e| e.to_string());
            let _ = reply.send(result);
        }
    }
}

#[cfg(test)]
mod test;
