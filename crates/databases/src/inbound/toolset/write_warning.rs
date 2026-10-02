//! What a committed write's response could not include, told to the model so
//! it neither repeats the write nor trusts a missing schema.

use models_databases::DatabaseId;
use std::fmt;

use serde::{Serialize, Serializer};

/// One part of a committed write that did not complete.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteWarning {
    /// The change committed but the schema read after it failed.
    SchemaNotRefreshed {
        /// The database to describe again.
        database_id: DatabaseId,
        /// Why the read failed, as the model was told.
        cause: String,
    },
}

impl fmt::Display for WriteWarning {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SchemaNotRefreshed { database_id, cause } => write!(
                formatter,
                "The change was saved, but its schema could not be refreshed: {cause} Call DescribeDatabase with databaseId {database_id} before continuing; do not repeat this successful mutation."
            ),
        }
    }
}

/// Every warning of one response, serialized as one sentence-joined string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteWarnings(pub Vec<WriteWarning>);

impl fmt::Display for WriteWarnings {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (index, warning) in self.0.iter().enumerate() {
            if index > 0 {
                formatter.write_str(" ")?;
            }
            write!(formatter, "{warning}")?;
        }
        Ok(())
    }
}

impl Serialize for WriteWarnings {
    fn serialize<Target: Serializer>(
        &self,
        serializer: Target,
    ) -> Result<Target::Ok, Target::Error> {
        serializer.collect_str(self)
    }
}
