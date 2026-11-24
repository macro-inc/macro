//! Importing Autodesk Fusion designs, and every version of them, into Macro.
//!
//! Each APS item (a design or file in a Fusion hub) becomes one Macro file
//! document, and each of its APS versions one version of that document,
//! oldest first. A ledger records every APS version the import has seen, so
//! a re-sync adds only new ones. The agent drives it through the
//! `ImportFromFusion` tool; the `enable-fusion-import` flag gates it.

#![deny(missing_docs)]

pub mod domain;

pub mod outbound;
