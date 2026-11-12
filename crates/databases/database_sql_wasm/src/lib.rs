//! The browser build of [`database_sql_engine`], the database SQL engine the web app runs in the browser. wasm-pack builds this
//! crate (`--out-name database_sql_engine`); the wasm-bindgen exports live in `database_sql_engine`
//! and are linked in through this re-export.

pub use database_sql_engine::*;
