//! Lazy, viewer-scoped pipeline entries composed onto CRM Soup entities.

use std::{collections::HashMap, convert::Infallible, sync::Arc};

use async_graphql::{
    Context,
    dataloader::{DataLoader, Loader},
};
use crm::domain::pipelines::{PipelineEntry, PipelineRecordType};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::{CrmGraphqlContext, GraphqlCrmPipelineEntry, graphql_error};

/// A company or contact whose pipeline entries are requested.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CrmRecord {
    /// A CRM company.
    Company(Uuid),
    /// A CRM contact.
    Contact(Uuid),
}

impl CrmRecord {
    fn record_type(self) -> PipelineRecordType {
        match self {
            Self::Company(_) => PipelineRecordType::Company,
            Self::Contact(_) => PipelineRecordType::Contact,
        }
    }

    fn id(self) -> Uuid {
        match self {
            Self::Company(id) | Self::Contact(id) => id,
        }
    }
}

/// Viewer-scoped entries reader; one domain read per record type for every
/// record a request asks about.
pub struct PipelineEntriesLoader {
    context: CrmGraphqlContext,
    user: MacroUserIdStr<'static>,
}

impl Loader<CrmRecord> for PipelineEntriesLoader {
    type Value = async_graphql::Result<Arc<[PipelineEntry]>>;
    type Error = Infallible;

    async fn load(
        &self,
        keys: &[CrmRecord],
    ) -> Result<HashMap<CrmRecord, Self::Value>, Self::Error> {
        let mut loaded = HashMap::with_capacity(keys.len());
        for record_type in [PipelineRecordType::Company, PipelineRecordType::Contact] {
            let records: Vec<CrmRecord> = keys
                .iter()
                .copied()
                .filter(|record| record.record_type() == record_type)
                .collect();
            if records.is_empty() {
                continue;
            }
            let ids: Vec<Uuid> = records.iter().map(|record| record.id()).collect();
            match self.context.0.entries(&self.user, record_type, &ids).await {
                Ok(entries) => {
                    let mut by_record: HashMap<Uuid, Vec<PipelineEntry>> = HashMap::new();
                    for entry in entries {
                        by_record.entry(entry.record_id).or_default().push(entry);
                    }
                    for record in records {
                        let entries = by_record.remove(&record.id()).unwrap_or_default();
                        loaded.insert(record, Ok(entries.into()));
                    }
                }
                Err(error) => {
                    let error = graphql_error(error);
                    for record in records {
                        loaded.insert(record, Err(error.clone()));
                    }
                }
            }
        }
        Ok(loaded)
    }
}

/// Coalesce the entries edges of a request's companies and contacts without
/// retaining data across mutations or subscription events.
pub fn pipeline_entries_loader(
    context: CrmGraphqlContext,
    user: MacroUserIdStr<'static>,
) -> DataLoader<PipelineEntriesLoader> {
    DataLoader::new(PipelineEntriesLoader { context, user }, tokio::spawn)
}

/// Load the record's entries only when the edge is requested.
pub async fn load_pipeline_entries(
    ctx: &Context<'_>,
    record: CrmRecord,
) -> async_graphql::Result<Vec<GraphqlCrmPipelineEntry>> {
    match ctx
        .data::<DataLoader<PipelineEntriesLoader>>()?
        .load_one(record)
        .await
    {
        Ok(Some(entries)) => Ok(entries?
            .iter()
            .cloned()
            .map(GraphqlCrmPipelineEntry::new)
            .collect()),
        Ok(None) => Err(async_graphql::Error::new(
            "pipeline entries are unavailable",
        )),
        Err(impossible) => match impossible {},
    }
}
