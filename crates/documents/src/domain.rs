//! Domain layer: models, ports (trait interfaces), and service implementation.

/// Event-to-activity mappings for this domain.
pub mod activity;
#[cfg(feature = "ai_tools")]
pub mod ai_editing;
pub mod branch_name;
/// A document's comment threads, read through the shared message service.
#[cfg(feature = "ai_tools")]
pub mod comments;
pub mod content;
/// Unified entity-mutation capability impls.
#[cfg(feature = "service")]
pub mod entity_mutation;
pub mod events;
#[cfg(feature = "ports")]
pub mod markdown_backfill;

#[cfg(feature = "document_create")]
pub mod create;

#[cfg(feature = "document_create")]
pub mod starter;

#[cfg(feature = "ports")]
pub mod upload_finalize;

pub mod models;
#[cfg(feature = "axum")]
pub mod permission_token;
pub mod response;

/// Permission-scoped spreadsheet inspection, calculation, and mutation.
#[cfg(feature = "ai_tools")]
pub mod spreadsheet;

/// Reading and editing uploaded Word documents through their live copy.
#[cfg(feature = "ai_tools")]
pub mod word_document;

/// Reading and editing PowerPoint presentations with the native engine.
#[cfg(feature = "ai_tools")]
pub mod presentation;

/// Reading Figma designs with the native engine.
#[cfg(feature = "ai_tools")]
pub mod design;

/// Reading Photoshop documents with the native engine.
#[cfg(feature = "ai_tools")]
pub mod photoshop;

/// Reading Illustrator documents with the native engine.
#[cfg(feature = "ai_tools")]
pub mod illustrator;

#[cfg(feature = "ports")]
pub mod ports;

#[cfg(feature = "service")]
pub mod service;

#[cfg(feature = "ports")]
pub mod purge;
