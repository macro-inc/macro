//! The engine, as the browser calls it.
//!
//! Entry points: [`build_catalog`], the catalog a statement names tables in;
//! [`Query`], a statement held open between steps, made from SQL or from a
//! view by [`run_view`]; and the view helpers [`board`] and [`key_between`].
//! A driver reads the first [`Step`] from [`Query::start`], serves each read,
//! and feeds the pages or bins back until a step is `done`; writes go to the
//! server, never through here. Values cross as plain JSON objects in the shapes `serde`
//! gives the engine's types, which `bin/database_sql_types.rs` writes out as
//! TypeScript for `apps/web/src/lib/core/database-sql/wasm-module.ts`. Every
//! failure is thrown as an [`EngineError`], except [`key_between`]'s, a JS
//! `Error`.
//!
//! Only the wasm-bindgen glue lives here; the engine knows nothing of it.

use models_databases::DatabaseId;
use models_databases::position::{self, Position};
use models_databases::views::{CardPosition, DatabaseView};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_wasm_bindgen::Serializer;
use wasm_bindgen::prelude::*;

use crate::catalog::{Catalog, Schema, build};
use crate::engine::{Engine, Step};
use crate::fold::Bin;
use crate::run::{EngineError, Input, Outcome, Page, RunError};
use crate::view;

/// One statement in flight.
#[wasm_bindgen]
pub struct Query {
    engine: Engine,
    first: Option<Step>,
}

impl Query {
    /// A statement whose first step is waiting to be taken.
    fn held((engine, first): (Engine, Step)) -> Query {
        Query {
            engine,
            first: Some(first),
        }
    }
}

#[wasm_bindgen]
impl Query {
    /// Compile `sql` against `catalog` (a `Catalog` as JSON).
    ///
    /// # Errors
    ///
    /// Throws an `EngineError` when the catalog cannot be read or the
    /// statement does not compile.
    #[wasm_bindgen(constructor)]
    pub fn new(catalog: JsValue, sql: &str) -> Result<Query, JsValue> {
        let catalog: Catalog = read(Input::Catalog, catalog)?;
        Engine::start(&catalog, sql)
            .map(Query::held)
            .map_err(thrown)
    }

    /// The first step. Taken once; a second call is an error.
    pub fn start(&mut self) -> Result<JsValue, JsValue> {
        let step = self
            .first
            .take()
            .ok_or_else(|| thrown(RunError::AlreadyStarted))?;
        to_js(&step)
    }

    /// Feed one page (`{rows, next}`) of the outstanding request.
    pub fn feed_page(&mut self, request_id: u32, page: JsValue) -> Result<JsValue, JsValue> {
        let page: Page = read(Input::Page, page)?;
        to_js(&self.engine.feed_page(request_id, page).map_err(thrown)?)
    }

    /// Feed the bins (`[{key, count}]`) of the outstanding request.
    pub fn feed_bins(&mut self, request_id: u32, bins: JsValue) -> Result<JsValue, JsValue> {
        let bins: Vec<Bin> = read(Input::Bins, bins)?;
        to_js(&self.engine.feed_bins(request_id, bins).map_err(thrown)?)
    }
}

/// The catalog a statement run from `scope` (a database id) names tables in,
/// built from `schema` (a `Schema` as JSON).
///
/// # Errors
///
/// Throws an `EngineError` when the schema or the scope cannot be read.
#[wasm_bindgen(js_name = buildCatalog)]
pub fn build_catalog(schema: JsValue, scope: Option<String>) -> Result<JsValue, JsValue> {
    let schema: Schema = read(Input::Schema, schema)?;
    let scope = scope
        .map(|scope| scope.parse::<DatabaseId>())
        .transpose()
        .map_err(|error| {
            thrown(RunError::Unreadable {
                what: Input::Scope,
                message: error.to_string(),
            })
        })?;
    to_js(&build(&schema, scope))
}

/// The rows `view` (a `DatabaseView` as JSON) shows, as a statement to
/// drive like any other.
///
/// # Errors
///
/// Throws an `EngineError` when the catalog or the view cannot be read, or
/// the view does not fit its table.
#[wasm_bindgen(js_name = runView)]
pub fn run_view(catalog: JsValue, view: JsValue) -> Result<Query, JsValue> {
    let catalog: Catalog = read(Input::Catalog, catalog)?;
    let view: DatabaseView = read(Input::View, view)?;
    let select = view::compile_view(&view, &catalog).map_err(|problem| thrown(problem.into()))?;
    Ok(Query::held(Engine::from_select(&catalog, select)))
}

/// The `Board` a board view makes of `outcome`, what its `runView` query
/// produced, with the cards' stored `positions` (`CardPosition[]`).
///
/// # Errors
///
/// Throws an `EngineError` when an argument cannot be read, or the view is
/// not a board that fits its table.
#[wasm_bindgen]
pub fn board(
    catalog: JsValue,
    view: JsValue,
    outcome: JsValue,
    positions: JsValue,
) -> Result<JsValue, JsValue> {
    let catalog: Catalog = read(Input::Catalog, catalog)?;
    let view: DatabaseView = read(Input::View, view)?;
    let outcome: Outcome = read(Input::Outcome, outcome)?;
    let positions: Vec<CardPosition> = read(Input::Positions, positions)?;
    to_js(
        &view::board(&view, &catalog, &outcome, &positions)
            .map_err(|problem| thrown(problem.into()))?,
    )
}

/// A position key that sorts after `before` and before `after`; leave one
/// out to place it first or last.
///
/// # Errors
///
/// Throws an `Error` when a bound is not a key or they are out of order.
#[wasm_bindgen(js_name = keyBetween)]
pub fn key_between(before: Option<String>, after: Option<String>) -> Result<String, JsError> {
    let bound = |key: Option<String>| key.map(|key| key.parse::<Position>()).transpose();
    let (before, after) = (bound(before)?, bound(after)?);
    position::key_between(before.as_ref(), after.as_ref())
        .map(String::from)
        .map_err(|error| JsError::new(&error.to_string()))
}

fn read<Value: DeserializeOwned>(what: Input, value: JsValue) -> Result<Value, JsValue> {
    serde_wasm_bindgen::from_value(value).map_err(|error| {
        thrown(RunError::Unreadable {
            what,
            message: error.to_string(),
        })
    })
}

/// The error as the value a driver catches.
fn thrown(error: RunError) -> JsValue {
    EngineError::from(error)
        .serialize(&Serializer::json_compatible())
        .expect("an EngineError is strings, numbers and ids, which always serialize")
}

/// Plain objects and arrays, as JSON would give them: maps become objects
/// rather than JS `Map`s, so a row's cells read as `cells[key]`.
fn to_js(value: &impl Serialize) -> Result<JsValue, JsValue> {
    value
        .serialize(&Serializer::json_compatible())
        .map_err(|error| {
            thrown(RunError::Unwritable {
                message: error.to_string(),
            })
        })
}
