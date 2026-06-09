use crate::api::context::SearchHandlerState;
use crate::api::search::simple::SearchError;
use email_db_client::contacts::get::ThreadContactsMap;
use indexmap::IndexMap;
use models_email::service::message::{MessageSenderInfo, ThreadHistoryInfo};
use models_search::email::{
    EmailSearchParticipant, EmailSearchResponseItem, EmailSearchResponseItemWithMetadata,
    EmailSearchResult,
};
use opensearch_client::search::model::SearchGotoContent;
use sqlx::types::Uuid;
use std::collections::HashMap;

/// Enriches email search results with metadata
#[tracing::instrument(skip(ctx, results), err)]
pub(in crate::api::search) async fn enrich_emails(
    ctx: &SearchHandlerState,
    user_id: &str,
    results: Vec<opensearch_client::search::model::SearchHit>,
) -> Result<Vec<EmailSearchResponseItemWithMetadata>, SearchError> {
    let results: Vec<opensearch_client::search::model::SearchHit> = results
        .into_iter()
        .filter(|r| r.entity_type == models_opensearch::SearchEntityType::Emails)
        .collect();

    if results.is_empty() {
        return Ok(vec![]);
    }

    // Resolve every inbox the user can access (their own + delegated) so hits
    // from delegated inboxes are enriched rather than dropped.
    let inboxes = email_db_client::links::get::fetch_inboxes_for_macro_id(&ctx.db, user_id)
        .await
        .map_err(SearchError::InternalError)?;
    if inboxes.is_empty() {
        return Ok(vec![]);
    }
    let link_ids: Vec<Uuid> = inboxes.iter().map(|l| l.id).collect();

    // Extract thread IDs from results
    let thread_ids: Vec<Uuid> = results.iter().map(|r| r.entity_id).collect();

    // Fetch email thread metadata directly from DB
    let thread_histories =
        email_db_client::user_history::get_thread_summary_info(&ctx.db, &link_ids, &thread_ids)
            .await
            .map_err(SearchError::InternalError)?;

    let message_ids: Vec<Uuid> = results
        .iter()
        .filter_map(|r| {
            if let Some(goto) = &r.goto {
                match goto {
                    // This should only ever be an email goto
                    SearchGotoContent::Emails(goto) => Some(goto.email_message_id),
                    _ => None,
                }
            } else {
                None
            }
        })
        .collect();

    let (message_senders_map, contacts_map) = tokio::try_join!(
        email_db_client::messages::get::get_message_sender_and_pretty_sender(
            &ctx.db,
            &link_ids,
            &message_ids,
        ),
        email_db_client::contacts::get::fetch_contacts_by_thread_ids(&ctx.db, &thread_ids),
    )
    .map_err(SearchError::InternalError)?;

    // Construct enriched results
    let enriched_results =
        construct_search_result(results, thread_histories, message_senders_map, contacts_map)
            .map_err(SearchError::InternalError)?;

    Ok(enriched_results)
}

pub fn construct_search_result(
    search_results: Vec<opensearch_client::search::model::SearchHit>,
    thread_histories: HashMap<Uuid, ThreadHistoryInfo>,
    message_senders: HashMap<Uuid, MessageSenderInfo>,
    contacts_map: ThreadContactsMap,
) -> anyhow::Result<Vec<EmailSearchResponseItemWithMetadata>> {
    // construct entity hit map of id -> vec<hits> using IndexMap to preserve insertion order
    let entity_id_hit_map: IndexMap<Uuid, Vec<EmailSearchResult>> = search_results
        .into_iter()
        .filter_map(|hit| {
            let result = if let Some(SearchGotoContent::Emails(goto)) = hit.goto {
                let sender_info = message_senders.get(&goto.email_message_id);
                let sender = sender_info
                    .map(|a| a.sender.clone())
                    .unwrap_or(goto.sender.clone());
                let pretty_sender = sender_info
                    .map(|a| a.pretty_sender.clone())
                    .unwrap_or(goto.sender.clone());
                Some(EmailSearchResult {
                    message_id: Some(goto.email_message_id),
                    bcc: goto.bcc,
                    cc: goto.cc,
                    labels: goto.labels,
                    sent_at: goto.sent_at,
                    sender,
                    pretty_sender,
                    recipients: goto.recipients,
                    highlight: hit.highlight.into(),
                    score: hit.score,
                })
            } else {
                let thread_info = thread_histories.get(&hit.entity_id);
                if let Some(thread_info) = thread_info {
                    let sender = thread_info.sender.clone();
                    let pretty_sender = thread_info.pretty_sender.clone();
                    // name match
                    Some(EmailSearchResult {
                        message_id: None,
                        bcc: vec![],
                        cc: vec![],
                        labels: vec![],
                        sent_at: None,
                        sender,
                        pretty_sender,
                        recipients: vec![],
                        highlight: hit.highlight.into(),
                        score: hit.score,
                    })
                } else {
                    tracing::warn!("No thread info found for entity id {}", hit.entity_id);
                    None
                }
            };

            result.map(|a| (hit.entity_id, a))
        })
        .fold(IndexMap::new(), |mut map, (entity_id, result)| {
            map.entry(entity_id).or_insert_with(Vec::new).push(result);
            map
        });

    // now construct the search results in the original search result order
    let result: Vec<EmailSearchResponseItemWithMetadata> = entity_id_hit_map
        .into_iter()
        .filter_map(|(entity_id, hits)| {
            if let Some(info) = thread_histories.get(&entity_id) {
                let info = info.clone();
                let participants = contacts_map
                    .get(&entity_id)
                    .map(|contacts| {
                        contacts
                            .iter()
                            .map(|(email, name)| EmailSearchParticipant {
                                email: email.clone(),
                                name: name.clone(),
                            })
                            .collect()
                    })
                    .unwrap_or_default();

                Some(EmailSearchResponseItemWithMetadata {
                    created_at: info.created_at,
                    updated_at: info.updated_at,
                    viewed_at: info.viewed_at,
                    snippet: info.snippet,
                    is_read: info.is_read,
                    inbox_visible: info.inbox_visible,
                    is_draft: info.is_draft,
                    is_important: info.is_important,
                    extra: EmailSearchResponseItem {
                        id: entity_id,
                        thread_id: entity_id,
                        owner_id: info.user_id.clone(),
                        user_id: info.user_id,
                        link_id: info.link_id,
                        name: info.subject.clone(),
                        subject: info.subject,
                        email_message_search_results: hits,
                        participants,
                    },
                })
            } else {
                None
            }
        })
        .collect();

    Ok(result)
}

#[cfg(test)]
mod test;
