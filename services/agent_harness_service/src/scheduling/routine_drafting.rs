//! What finding a routine draft's items uses from this process: the fast
//! model call through the model router, admitted and metered as the owner's
//! automation usage, and document storage's name lookup, as the owner.

use std::{sync::Arc, time::Duration};

use agent::{Message, PredefinedModel};
use ai_billing::{AiAdmissionError, AiAdmissionService};
use ai_usage::{AiFeature, UsageContext, UsageRecorder};
use macro_authorization::{INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::compat::IntoRootcause as _;
use scheduled_action::domain::drafts::finding::{
    DraftCall, DraftCallError, ItemKind, NameAnswer, NameAnswers, NameAsked, NameLookupError,
    NameMatch,
};
use scheduled_action::domain::ports::{DraftModel, NameLookups};
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod test;

/// Longest a name lookup may take; the drafter goes on without it after.
const LOOKUP_TIMEOUT: Duration = Duration::from_secs(5);
/// Where document storage looks names up.
const NAMES_PATH: &str = "search/names";

/// Draft model calls on the router, billed as the owner's automation usage.
pub(super) struct RouterDraftModels {
    pub admission: Arc<dyn AiAdmissionService>,
    pub recorder: Arc<dyn UsageRecorder>,
}

// Object-safe (`async_trait`): the drafter holds it as `Arc<dyn DraftModel>`.
#[async_trait::async_trait]
impl DraftModel for RouterDraftModels {
    async fn admit(&self, owner: &MacroUserIdStr<'static>) -> Result<(), AiAdmissionError> {
        self.admission.admit(owner, AiFeature::Automation).await
    }

    async fn complete(
        &self,
        owner: &MacroUserIdStr<'static>,
        call: DraftCall<'_>,
    ) -> Result<String, DraftCallError> {
        agent::complete_with_history_and_params(
            PredefinedModel::Fast.to_string(),
            call.system,
            vec![Message::user(call.prompt.to_owned())],
            None,
            self.recorder.as_ref(),
            UsageContext::new(AiFeature::Automation, owner.clone()),
        )
        .await
        .map_err(|error| DraftCallError(error.into_rootcause()))
    }
}

/// Document storage's `POST /search/names`, as the owner.
pub(super) struct DocumentStorageNames {
    client: reqwest::Client,
    url: String,
    internal_api_key: String,
}

impl DocumentStorageNames {
    pub(super) fn new(base: &str, internal_api_key: String) -> anyhow::Result<Self> {
        Ok(Self {
            client: reqwest::Client::builder().timeout(LOOKUP_TIMEOUT).build()?,
            url: format!("{}/{NAMES_PATH}", base.trim_end_matches('/')),
            internal_api_key,
        })
    }
}

// Object-safe (`async_trait`): the drafter holds it as `Arc<dyn NameLookups>`.
#[async_trait::async_trait]
impl NameLookups for DocumentStorageNames {
    async fn look_up(
        &self,
        owner: &MacroUserIdStr<'static>,
        names: &[NameAsked],
    ) -> Result<NameAnswers, NameLookupError> {
        let body = NamesRequest {
            names: names
                .iter()
                .map(|asked| NameQuery {
                    name: &asked.name,
                    kinds: &asked.kinds,
                })
                .collect(),
        };
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let response = self
            .client
            .post(&self.url)
            .headers(headers)
            .header(INTERNAL_API_KEY_HEADER, &self.internal_api_key)
            .header(INTERNAL_MACRO_USER_ID_HEADER, owner.as_ref())
            .json(&body)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|error| NameLookupError(rootcause::report!(error).into_dynamic()))?;
        let answer: NamesResponse = response
            .json()
            .await
            .map_err(|error| NameLookupError(rootcause::report!(error).into_dynamic()))?;
        if !answer.unavailable.is_empty() {
            tracing::warn!(
                unavailable = ?answer.unavailable,
                "some kinds of item couldn't be looked up by name"
            );
        }
        Ok(NameAnswers {
            answers: answer.results.into_iter().map(NameAnswer::from).collect(),
            unavailable: answer.unavailable,
        })
    }
}

/// `POST /search/names`'s body.
#[derive(Serialize)]
struct NamesRequest<'a> {
    names: Vec<NameQuery<'a>>,
}

#[derive(Serialize)]
struct NameQuery<'a> {
    name: &'a str,
    kinds: &'a [ItemKind],
}

/// `POST /search/names`'s answer.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NamesResponse {
    results: Vec<NameResult>,
    #[serde(default)]
    unavailable: Vec<ItemKind>,
}

#[derive(Deserialize)]
struct NameResult {
    name: String,
    matches: Vec<NameResultMatch>,
}

#[derive(Deserialize)]
struct NameResultMatch {
    name: String,
    exact: bool,
    item: NamedItem,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NamedItem {
    kind: ItemKind,
    id: String,
    definition_id: Option<String>,
}

impl From<NameResult> for NameAnswer {
    fn from(result: NameResult) -> Self {
        Self {
            name: result.name,
            matches: result
                .matches
                .into_iter()
                .map(|found| NameMatch {
                    name: found.name,
                    exact: found.exact,
                    kind: found.item.kind,
                    id: found.item.id,
                    definition_id: found.item.definition_id,
                })
                .collect(),
        }
    }
}
