//! One authoritative response, normalized at most once for every projection pass.
//!
//! A write runs the notification, Mail and property passes over the same
//! response, and each used to normalize it again. Normalizing a Soup page
//! costs milliseconds, more than the storage reads those passes make.

use crate::SoupFilterCacheAdapterError;
use crate::parsed_document::parsed_document;
use cache_core::normalize::{RecordUpdates, normalize};
use serde_json::{Map, Value};
use std::sync::OnceLock;

/// An authoritative GraphQL response that the projection passes share.
pub struct WriteResponse<'a> {
    schema: &'a cache_core::meta::Schema,
    query: &'a str,
    operation: Option<&'a str>,
    variables: &'a Map<String, Value>,
    data: &'a Value,
    updates: OnceLock<RecordUpdates>,
}

impl<'a> WriteResponse<'a> {
    /// Wraps a response; nothing is normalized until a pass asks for it.
    pub fn new(
        schema: &'a cache_core::meta::Schema,
        query: &'a str,
        operation: Option<&'a str>,
        variables: &'a Map<String, Value>,
        data: &'a Value,
    ) -> Self {
        Self {
            schema,
            query,
            operation,
            variables,
            data,
            updates: OnceLock::new(),
        }
    }

    /// The application schema the response is normalized against.
    pub fn schema(&self) -> &'a cache_core::meta::Schema {
        self.schema
    }

    /// The GraphQL document text.
    pub fn query(&self) -> &'a str {
        self.query
    }

    /// The selected operation name.
    pub fn operation(&self) -> Option<&'a str> {
        self.operation
    }

    /// The operation variables.
    pub fn variables(&self) -> &'a Map<String, Value> {
        self.variables
    }

    /// The response data.
    pub fn data(&self) -> &'a Value {
        self.data
    }

    /// The normalized records of the response, computed on first use. A
    /// failure is not kept, so every pass reports it as before.
    pub(crate) fn updates(&self) -> Result<&RecordUpdates, SoupFilterCacheAdapterError> {
        if let Some(updates) = self.updates.get() {
            return Ok(updates);
        }
        let document = parsed_document(self.query)
            .map_err(|error| SoupFilterCacheAdapterError(error.to_string()))?;
        let operation = document
            .operation(self.operation)
            .map_err(|error| SoupFilterCacheAdapterError(error.to_string()))?;
        let updates = normalize(self.schema, operation, self.variables, self.data)
            .map_err(|error| SoupFilterCacheAdapterError(error.to_string()))?;
        Ok(self.updates.get_or_init(|| updates))
    }
}
