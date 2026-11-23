//! Measures bringing a production-size browser cache to a changed GraphQL
//! schema, in each tier, against a physical reset. Ignored: it needs
//! `bench-data/stored.turso` beside the crate, a storage-13 cache-bench
//! database that stores the bundled schema (soup-filter-cache-adapter's
//! `schema_cost` writes one with `CACHE_SCHEMA_OUT`), which the test runner
//! serves from the crate's directory. Run it with `--include-ignored
//! schema_cost`.

use super::*;
use cache_core::meta::{BUNDLED_SCHEMA_SDL, Schema, bundled_schema};
use std::sync::Arc;

/// The scope the cache bench writes its databases under.
const BENCH_SCOPE: &str = "cache-bench";
const BENCH_DATABASE: &str = "/bench-data/stored.turso";
/// Runs of every case; `CACHE_SCHEMA_RUNS` at build time sets another count.
const RUNS: &str = match option_env!("CACHE_SCHEMA_RUNS") {
    Some(runs) => runs,
    None => "3",
};

fn changed(sdl: String) -> Arc<Schema> {
    let schema = Schema::from_sdl(&sdl).unwrap();
    assert_ne!(schema.hash(), bundled_schema().hash());
    schema
}

/// The bundled schema with `declaration` added to `typename`.
fn added(typename: &str, declaration: &str) -> Arc<Schema> {
    let sdl = BUNDLED_SCHEMA_SDL;
    let start = sdl.find(&format!("\ntype {typename} ")).unwrap();
    let open = start + sdl[start..].find("{\n").unwrap() + 2;
    changed(format!("{}\t{declaration}\n{}", &sdl[..open], &sdl[open..]))
}

/// The bundled schema with `field` of `typename` declared as `declared`.
fn retyped(typename: &str, field: &str, declared: &str) -> Arc<Schema> {
    let sdl = BUNDLED_SCHEMA_SDL;
    let start = sdl.find(&format!("\ntype {typename} ")).unwrap();
    let end = start + sdl[start..].find("\n}").unwrap();
    let line = sdl[start..end]
        .lines()
        .find(|line| line.starts_with(&format!("\t{field}:")))
        .unwrap();
    let at = start + sdl[start..end].find(line).unwrap();
    changed(format!(
        "{}\t{field}: {declared}{}",
        &sdl[..at],
        &sdl[at + line.len()..]
    ))
}

async fn call(function: &js_sys::Function, arguments: &[JsValue]) -> JsValue {
    let promise = function
        .apply(&JsValue::NULL, &arguments.iter().collect::<js_sys::Array>())
        .unwrap();
    JsFuture::from(js_sys::Promise::from(promise))
        .await
        .unwrap()
}

/// The bench database's bytes, from the test runner's server.
async fn bench_bytes() -> JsValue {
    let fetch = js_sys::Function::new_with_args(
        "path",
        "return fetch(path).then((response) => { if (!response.ok) throw new Error(`${path}: ${response.status}`); return response.arrayBuffer(); }).then((buffer) => new Uint8Array(buffer))",
    );
    call(&fetch, &[BENCH_DATABASE.into()]).await
}

/// Writes `bytes` as the scope's database, with an empty WAL.
async fn place(bytes: &JsValue) {
    let place = js_sys::Function::new_with_args(
        "bytes, name",
        "return (async () => { const root = await navigator.storage.getDirectory(); for (const path of [name, `${name}-wal`]) { const file = await root.getFileHandle(path, { create: true }); const access = await file.createSyncAccessHandle(); access.truncate(0); if (path === name) access.write(bytes, { at: 0 }); access.flush(); access.close(); } })()",
    );
    call(
        &place,
        &[bytes.clone(), database_identity(BENCH_SCOPE).into()],
    )
    .await;
}

#[wasm_bindgen_test(async)]
#[ignore = "needs bench-data/stored.turso beside the crate"]
async fn schema_change_cost_on_a_retained_browser_cache() {
    let bytes = bench_bytes().await;
    let message = "GraphqlSoupEmailMessage";
    let thread = "GraphqlSoupEmailThread";
    let cases = [
        ("unchanged", bundled_schema()),
        (
            "a message field added",
            added(message, "cacheCostProbe: String"),
        ),
        (
            "message bodyText to Int",
            retyped(message, "bodyText", "Int"),
        ),
        (
            "thread isRead to String! (Mail facts read it)",
            retyped(thread, "isRead", "String!"),
        ),
        (
            "notification state to Int (every document's facts read it)",
            retyped("GraphqlNotification", "state", "Int"),
        ),
        (
            "query root renamed",
            changed(BUNDLED_SCHEMA_SDL.replace("SoupQueryRoot", "SoupQueryRootRenamed")),
        ),
    ];
    for run in 1..=RUNS.parse::<usize>().unwrap() {
        for (name, schema) in &cases {
            place(&bytes).await;
            RUNTIME_SCHEMA.with(|slot| *slot.borrow_mut() = Some(Arc::clone(schema)));
            let started = js_sys::Date::now();
            let (engine, outcome, change) =
                open_cache_inner(BENCH_SCOPE.into(), None, false, None, false)
                    .await
                    .expect("open bench cache");
            let open_ms = js_sys::Date::now() - started;
            resolved(engine.close()).await;
            let started = js_sys::Date::now();
            let (engine, _, again) = open_cache_inner(BENCH_SCOPE.into(), None, false, None, false)
                .await
                .expect("reopen bench cache");
            let reopen_ms = js_sys::Date::now() - started;
            resolved(engine.close()).await;
            web_sys_log(&format!(
                "run {run} {name}: open {open_ms} ms ({}), adopt {} ms {} dropped {} incomplete {} retired {}; reopen {reopen_ms} ms adopt {} ms {}",
                outcome.as_str(),
                change.adopt_ms,
                change.change,
                change.dropped_records,
                change.incomplete_documents,
                change.retired_overlays,
                again.adopt_ms,
                again.change,
            ));
        }
        // What every schema change cost before: a physical reset, then
        // opening the empty file.
        place(&bytes).await;
        RUNTIME_SCHEMA.with(|slot| *slot.borrow_mut() = Some(bundled_schema()));
        let started = js_sys::Date::now();
        destroy_cache(BENCH_SCOPE.into())
            .await
            .expect("reset bench cache");
        let (engine, _, _) = open_cache_inner(BENCH_SCOPE.into(), None, false, None, false)
            .await
            .expect("open reset cache");
        let reset_ms = js_sys::Date::now() - started;
        web_sys_log(&format!("run {run} reset: reset and open {reset_ms} ms"));
        close_and_destroy(&engine, BENCH_SCOPE).await;
    }
    RUNTIME_SCHEMA.with(|slot| *slot.borrow_mut() = None);
}

fn web_sys_log(line: &str) {
    wasm_bindgen_test::console_log!("{line}");
}
