use crate::api::search::simple::SearchError;
use email_contact_search::ContactType;
use macro_user_id::user_id::MacroUserId;
use models_opensearch::SearchEntityType;
use opensearch_client::search::model::{Highlight, SearchGotoContent, SearchGotoEmail, SearchHit};
use sqlx::{Pool, Postgres, types::Uuid};

#[derive(Debug)]
pub(in crate::api::search) struct FilterEmailResponse {
    pub thread_ids: Vec<String>,
    pub ids_only: bool,
}

/// Performs the name search over email subjects
#[tracing::instrument(skip(db), err)]
pub(in crate::api::search::simple) async fn search_names<'a>(
    db: &Pool<Postgres>,
    user_id: &MacroUserId<macro_user_id::lowercased::Lowercase<'a>>,
    filter_email_response: &FilterEmailResponse,
    term: String,
    limit: u32,
    cursor: models_search_cursor::SearchCursorOption,
) -> Result<(Vec<SearchHit>, models_search_cursor::SearchCursorOption), SearchError> {
    // If cursor is Done, no more results to fetch
    let inner_cursor = match cursor {
        models_search_cursor::SearchCursorOption::Done => {
            return Ok((vec![], models_search_cursor::SearchCursorOption::Done));
        }
        models_search_cursor::SearchCursorOption::NotDone(c) => c,
    };

    let thread_uuids = filter_email_response
        .thread_ids
        .iter()
        .map(|t| t.parse().unwrap())
        .collect::<Vec<Uuid>>();

    name_search::search_email_subjects(
        db,
        user_id,
        &thread_uuids,
        term,
        filter_email_response.ids_only,
        limit,
        inner_cursor,
    )
    .await
    .map_err(SearchError::NameSearch)
    .map(|response| {
        let hits = response
            .items
            .into_iter()
            .map(|n| SearchHit {
                entity_id: n.entity_id,
                entity_type: n.entity_type,
                score: None,

                highlight: Highlight {
                    name: Some(n.name),
                    ..Default::default()
                },
                goto: None,

                updated_at: Some(n.updated_at),
            })
            .collect();
        (hits, response.cursor)
    })
}

/// Performs the contact search over email contacts (sender, recipients, cc, bcc)
#[tracing::instrument(skip(db), err)]
pub(in crate::api::search::simple) async fn search_contacts<'a>(
    db: &Pool<Postgres>,
    user_id: MacroUserId<macro_user_id::lowercased::Lowercase<'a>>,
    term: String,
    limit: u32,
    cursor: models_search_cursor::SearchCursorOption,
) -> Result<(Vec<SearchHit>, models_search_cursor::SearchCursorOption), SearchError> {
    // If cursor is Done, no more results to fetch
    let inner_cursor = match cursor {
        models_search_cursor::SearchCursorOption::Done => {
            return Ok((vec![], models_search_cursor::SearchCursorOption::Done));
        }
        models_search_cursor::SearchCursorOption::NotDone(c) => c,
    };

    email_contact_search::search_email_contacts(db, user_id, term, limit, inner_cursor)
        .await
        .map_err(SearchError::EmailContactSearch)
        .map(|response| {
            let hits = response
                .items
                .into_iter()
                .map(|contact| {
                    // Build highlight based on contact type
                    let highlight = match contact.contact_type {
                        ContactType::From => Highlight {
                            sender: contact.contact_name.or(Some(contact.contact_email.clone())),
                            ..Default::default()
                        },
                        ContactType::To => Highlight {
                            recipients: vec![
                                contact
                                    .contact_name
                                    .unwrap_or_else(|| contact.contact_email.clone()),
                            ],
                            ..Default::default()
                        },
                        ContactType::Cc => Highlight {
                            cc: vec![
                                contact
                                    .contact_name
                                    .unwrap_or_else(|| contact.contact_email.clone()),
                            ],
                            ..Default::default()
                        },
                        ContactType::Bcc => Highlight {
                            bcc: vec![
                                contact
                                    .contact_name
                                    .unwrap_or_else(|| contact.contact_email.clone()),
                            ],
                            ..Default::default()
                        },
                    };

                    SearchHit {
                        entity_id: contact.thread_id,
                        entity_type: SearchEntityType::Emails,
                        score: None,
                        highlight,
                        goto: Some(SearchGotoContent::Emails(SearchGotoEmail {
                            email_message_id: contact.message_id,
                            bcc: vec![],
                            cc: vec![],
                            labels: vec![],
                            sent_at: None,
                            sender: contact.contact_email,
                            recipients: vec![],
                        })),
                        updated_at: Some(contact.updated_at),
                    }
                })
                .collect();
            (hits, response.cursor)
        })
}
