#[cfg(test)]
mod test;

use std::{collections::HashMap, sync::Arc};

use complete_graph::{EmailContentKey, EmailContentLoad, SoupEmailContentEdgeReader};
use email::domain::ports::EmailContentService;
use entity_access::domain::{models::AccessError, ports::EntityAccessService};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// Document-storage adapter for the Soup email-content edge.
///
/// The adapter batches authorization through the entity-access domain, then
/// passes only typed view receipts to the email domain.
pub(crate) struct DssEmailContentReader<S, EAS> {
    email_service: Arc<S>,
    entity_access_service: Arc<EAS>,
}

impl<S, EAS> DssEmailContentReader<S, EAS> {
    pub(crate) fn new(email_service: Arc<S>, entity_access_service: Arc<EAS>) -> Self {
        Self {
            email_service,
            entity_access_service,
        }
    }
}

impl<S, EAS> SoupEmailContentEdgeReader for DssEmailContentReader<S, EAS>
where
    S: EmailContentService,
    EAS: EntityAccessService,
{
    async fn get_email_content(
        &self,
        user_id: &MacroUserIdStr<'static>,
        keys: Vec<EmailContentKey>,
    ) -> HashMap<EmailContentKey, EmailContentLoad> {
        let thread_ids = keys
            .iter()
            .map(|key| key.thread_id.clone())
            .collect::<Vec<_>>();
        let mut receipts = self
            .entity_access_service
            .generate_email_thread_view_access_receipts(user_id, None, &thread_ids)
            .await;
        let access_results = keys.into_iter().map(|key| {
            let result = receipts
                .remove(&key.thread_id)
                .unwrap_or(Err(AccessError::Internal));
            (key, result)
        });

        let mut loads = HashMap::with_capacity(access_results.len());
        let mut authorized = Vec::new();
        let mut keys_by_thread_id = HashMap::new();

        for (key, access_result) in access_results {
            match access_result {
                Ok(receipt) => match Uuid::parse_str(&key.thread_id) {
                    Ok(thread_id) => {
                        keys_by_thread_id.insert(thread_id, key);
                        authorized.push(receipt);
                    }
                    Err(error) => {
                        tracing::error!(thread_id = %key.thread_id, ?error, "invalid authorized email thread ID");
                        loads.insert(key, EmailContentLoad::Failed);
                    }
                },
                Err(
                    AccessError::Unauthorized
                    | AccessError::UnauthorizedWithMessage(_)
                    | AccessError::NotFound(_),
                ) => {
                    loads.insert(key, EmailContentLoad::Missing);
                }
                Err(error) => {
                    tracing::error!(thread_id = %key.thread_id, ?error, "email content access check failed");
                    loads.insert(key, EmailContentLoad::Failed);
                }
            }
        }

        if authorized.is_empty() {
            return loads;
        }

        match self
            .email_service
            .get_latest_messages_parsed(authorized)
            .await
        {
            Ok(mut messages) => {
                for (thread_id, key) in keys_by_thread_id {
                    let load = messages
                        .remove(&thread_id)
                        .map_or(EmailContentLoad::Missing, |message| {
                            EmailContentLoad::Found(Box::new(message))
                        });
                    loads.insert(key, load);
                }
            }
            Err(error) => {
                tracing::error!(?error, "bulk email content load failed");
                for key in keys_by_thread_id.into_values() {
                    loads.insert(key, EmailContentLoad::Failed);
                }
            }
        }

        loads
    }
}
