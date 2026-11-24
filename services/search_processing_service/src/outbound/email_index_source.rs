//! Postgres adapter for the email indexing source port. Every read uses the
//! primary: a writer's version is its lease's grant time, so it must read
//! every change committed before that grant, which a lagging replica can miss.

use std::collections::HashMap;

use models_email::service::message::ParsedSearchMessage;
use models_properties::EntityType;
use properties::outbound::entity_properties_get_query::get_entity_properties_for_index_batch;
use rootcause::{Report, compat::IntoRootcause as _};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::email_index::{EmailIndexSource, ThreadFacts, ThreadProperty};

pub struct PgEmailIndexSource {
    primary: PgPool,
}

impl PgEmailIndexSource {
    pub fn new(primary: PgPool) -> Self {
        Self { primary }
    }
}

impl EmailIndexSource for PgEmailIndexSource {
    async fn message(&self, message_id: Uuid) -> Result<Option<ParsedSearchMessage>, Report> {
        email_db_client::messages::get_parsed_search::get_parsed_search_message_by_id(
            &self.primary,
            &message_id,
        )
        .await
        .map_err(|error| error.into_rootcause())
    }

    async fn thread_page(
        &self,
        thread_id: Uuid,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<ParsedSearchMessage>, Report> {
        email_db_client::messages::get_parsed_search::get_paginated_parsed_search_messages_by_thread_id(
            &self.primary,
            thread_id,
            offset,
            limit,
        )
        .await
        .map_err(|error| error.into_rootcause())
    }

    async fn threads_messages(
        &self,
        thread_ids: &[Uuid],
    ) -> Result<Vec<ParsedSearchMessage>, Report> {
        email_db_client::messages::get_parsed_search::get_parsed_search_messages_by_thread_ids(
            &self.primary,
            thread_ids,
        )
        .await
        .map_err(|error| error.into_rootcause())
    }

    async fn threads(&self, thread_ids: &[Uuid]) -> Result<HashMap<Uuid, ThreadFacts>, Report> {
        let owners = email_db_client::threads::get::get_thread_ids_with_macro_user_id_by_ids(
            &self.primary,
            thread_ids,
        )
        .await
        .map_err(|error| error.into_rootcause())?;
        let ids: Vec<String> = thread_ids.iter().map(Uuid::to_string).collect();
        let mut properties =
            get_entity_properties_for_index_batch(&self.primary, &ids, EntityType::Thread)
                .await
                .map_err(|error| error.into_rootcause())?;

        Ok(owners
            .into_iter()
            .map(|(thread_id, owner)| {
                let properties = properties
                    .remove(&thread_id.to_string())
                    .unwrap_or_default()
                    .into_iter()
                    .map(|property| ThreadProperty {
                        definition_id: property.definition_id,
                        values: property.values,
                        number_value: property.number_value,
                        date_value: property.date_value,
                    })
                    .collect();
                (thread_id, ThreadFacts { owner, properties })
            })
            .collect())
    }
}
