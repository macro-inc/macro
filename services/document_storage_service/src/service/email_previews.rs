//! Consistency wiring for the shared REST/GraphQL Soup email reader.

use email::domain::{
    models::{EmailErr, EnrichedEmailThreadPreview, GetEmailsRequest},
    ports::EmailPreviewServiceReadOnly,
};
use models_pagination::{PaginatedCursor, SimpleSortMethod};
use uuid::Uuid;

/// CRM eligibility contains revocable grants. Route the whole preview read to
/// primary so its candidate SQL and enrichment observe committed policy changes.
/// The email domain still authorizes the scope and applies every eligibility rule.
#[derive(Clone)]
pub(crate) struct ConsistentEmailPreviewReader<P, R> {
    primary: P,
    replica: R,
}

impl<P, R> ConsistentEmailPreviewReader<P, R> {
    pub(crate) fn new(primary: P, replica: R) -> Self {
        Self { primary, replica }
    }
}

impl<P: EmailPreviewServiceReadOnly, R: EmailPreviewServiceReadOnly> EmailPreviewServiceReadOnly
    for ConsistentEmailPreviewReader<P, R>
{
    #[tracing::instrument(skip_all, err, fields(crm_scope = req.crm_scope.is_some()))]
    async fn get_email_thread_previews(
        &self,
        req: GetEmailsRequest,
    ) -> Result<PaginatedCursor<EnrichedEmailThreadPreview, Uuid, SimpleSortMethod, ()>, EmailErr>
    {
        if req.crm_scope.is_some() {
            // Never fall back to a replica after an error: it may still grant
            // access that a committed withdrawal or exclusion has revoked.
            self.primary.get_email_thread_previews(req).await
        } else {
            self.replica.get_email_thread_previews(req).await
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use email::domain::models::{PreviewView, PreviewViewStandardLabel};
    use macro_user_id::user_id::MacroUserIdStr;
    use models_pagination::{Cursor, CursorVal, Query};
    use std::sync::Mutex;

    #[derive(Default)]
    struct Reader {
        requests: Mutex<Vec<GetEmailsRequest>>,
        fail: bool,
    }

    impl EmailPreviewServiceReadOnly for Reader {
        async fn get_email_thread_previews(
            &self,
            req: GetEmailsRequest,
        ) -> Result<PaginatedCursor<EnrichedEmailThreadPreview, Uuid, SimpleSortMethod, ()>, EmailErr>
        {
            self.requests.lock().unwrap().push(req);
            if self.fail {
                Err(EmailErr::RepoErr(anyhow::anyhow!("primary unavailable")))
            } else {
                Ok(PaginatedCursor::from_parts(vec![], None))
            }
        }
    }

    fn request(scope: serde_json::Value, continuation: bool) -> GetEmailsRequest {
        let query = if continuation {
            Query::Cursor(Cursor {
                id: Uuid::from_u128(45),
                limit: 25,
                val: CursorVal {
                    sort_type: SimpleSortMethod::UpdatedAt,
                    last_val: chrono::DateTime::UNIX_EPOCH,
                },
                filter: None,
            })
        } else {
            Query::Sort(SimpleSortMethod::UpdatedAt, None)
        };
        GetEmailsRequest {
            view: PreviewView::StandardLabel(PreviewViewStandardLabel::All),
            link_ids: vec![Uuid::from_u128(46)],
            macro_id: MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap(),
            limit: Some(25),
            query,
            include_frecency: true,
            team_receipt: None,
            crm_scope: serde_json::from_value(scope).unwrap(),
        }
    }

    #[tokio::test]
    async fn crm_pages_revalidate_on_primary_and_preserve_request() {
        let reader = ConsistentEmailPreviewReader::new(Reader::default(), Reader::default());
        for scope in [
            serde_json::json!({"Domains": ["example.com"]}),
            serde_json::json!({"Addresses": ["contact@example.com"]}),
        ] {
            for continuation in [false, true] {
                let req = request(scope.clone(), continuation);
                let expected_scope = req.crm_scope.clone();
                let page = reader.get_email_thread_previews(req).await.unwrap();
                assert!(page.items.is_empty());
                let mut calls = reader.primary.requests.lock().unwrap();
                let forwarded = calls.pop().unwrap();
                assert_eq!(forwarded.crm_scope, expected_scope);
                assert_eq!(forwarded.link_ids, vec![Uuid::from_u128(46)]);
                assert_eq!(forwarded.limit, Some(25));
                assert!(forwarded.include_frecency);
                assert_eq!(matches!(forwarded.query, Query::Cursor(_)), continuation);
                assert!(reader.replica.requests.lock().unwrap().is_empty());
            }
        }
    }

    #[tokio::test]
    async fn ordinary_inbox_pages_keep_the_replica() {
        let reader = ConsistentEmailPreviewReader::new(Reader::default(), Reader::default());
        for continuation in [false, true] {
            reader
                .get_email_thread_previews(request(serde_json::Value::Null, continuation))
                .await
                .unwrap();
        }
        assert!(reader.primary.requests.lock().unwrap().is_empty());
        assert_eq!(reader.replica.requests.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn primary_failure_cannot_fall_back_to_stale_consent() {
        let reader = ConsistentEmailPreviewReader::new(
            Reader {
                fail: true,
                ..Reader::default()
            },
            Reader::default(),
        );
        let error = reader
            .get_email_thread_previews(request(
                serde_json::json!({"Domains": ["example.com"]}),
                false,
            ))
            .await
            .unwrap_err();
        assert_eq!(error.to_string(), "primary unavailable");
        assert_eq!(reader.primary.requests.lock().unwrap().len(), 1);
        assert!(reader.replica.requests.lock().unwrap().is_empty());
    }
}
