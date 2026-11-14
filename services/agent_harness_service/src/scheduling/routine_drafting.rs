//! What finding a routine draft's items uses from this process: the fast
//! model call through the model router, admitted and metered as the owner's
//! automation usage, and the existing name search, as the owner.

use std::{sync::Arc, time::Duration};

use agent::{Message, PredefinedModel};
use ai_billing::{AiAdmissionError, AiAdmissionService};
use ai_usage::{AiFeature, UsageContext, UsageRecorder};
use document_sub_type::DocumentSubType;
use futures::StreamExt as _;
use macro_user_id::user_id::MacroUserIdStr;
use models_search::channel::ChannelNameSearchRequest;
use models_search::unified::{
    UnifiedSearchIndex, UnifiedSearchRequest, UnifiedSearchResponseItem,
    entity_filters_from_include,
};
use models_search::{MatchType, SearchOn, TermMatching};
use rootcause::compat::IntoRootcause as _;
use scheduled_action::domain::drafts::finding::{
    DraftCall, DraftCallError, ItemKind, NameAnswer, NameAnswers, NameAsked, NameLookupError,
    NameMatch, same_name,
};
use scheduled_action::domain::ports::{DraftModel, NameLookups};
use search_service_client::SearchServiceClient;

#[cfg(test)]
mod test;

/// Longest a name lookup may take; the drafter goes on without it after.
const LOOKUP_TIMEOUT: Duration = Duration::from_secs(5);
/// The kinds the existing search finds by name: channels by the name their
/// viewer sees, and folders, documents and tasks from the search index.
const SEARCHED: &[ItemKind] = &[
    ItemKind::Channel,
    ItemKind::Project,
    ItemKind::Document,
    ItemKind::Task,
];
/// How many items one search reads for one name.
const ITEMS_PER_NAME: i64 = 25;
/// How many names are searched at once.
const NAMES_AT_ONCE: usize = 4;
/// What a channel name search wraps the matched words in.
const HIGHLIGHT_TAGS: [&str; 2] = ["<macro_em>", "</macro_em>"];

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

/// The existing name search (`/internal/search` and its channel names), as
/// the owner, compared with each name exactly here.
pub(super) struct SearchNames {
    client: SearchServiceClient,
    /// How long one lookup may take: [`LOOKUP_TIMEOUT`].
    timeout: Duration,
}

impl SearchNames {
    pub(super) fn new(client: SearchServiceClient) -> Self {
        Self {
            client,
            timeout: LOOKUP_TIMEOUT,
        }
    }

    /// The items of the kinds `asked` wants whose names hold its words.
    async fn search(&self, owner: &str, asked: &NameAsked) -> Searched {
        let wants = |kind: ItemKind| asked.kinds.is_empty() || asked.kinds.contains(&kind);
        let query = asked.name.trim();
        let query = query.strip_prefix(['#', '@']).unwrap_or(query).trim();
        let mut indexes = Vec::new();
        if wants(ItemKind::Document) || wants(ItemKind::Task) {
            indexes.push(UnifiedSearchIndex::Documents);
        }
        if wants(ItemKind::Project) {
            indexes.push(UnifiedSearchIndex::Projects);
        }
        let channels = async {
            if !wants(ItemKind::Channel) {
                return None;
            }
            let request = ChannelNameSearchRequest {
                query: query.to_owned(),
                match_type: MatchType::Exact,
            };
            Some(
                self.client
                    .search_channel_names(owner, request, None, ITEMS_PER_NAME)
                    .await
                    .map(|response| {
                        let items = response
                            .results
                            .into_iter()
                            .filter_map(|hit| {
                                let mut name = hit.highlight.name?;
                                for tag in HIGHLIGHT_TAGS {
                                    name = name.replace(tag, "");
                                }
                                Some((ItemKind::Channel, hit.channel_id.to_string(), name))
                            })
                            .collect::<Vec<_>>();
                        (items, response.next_cursor.is_some())
                    }),
            )
        };
        let indexed = async {
            if indexes.is_empty() {
                return None;
            }
            let request = UnifiedSearchRequest {
                query: query.to_owned(),
                match_type: MatchType::Exact,
                filters: entity_filters_from_include(indexes.clone(), Default::default()),
                search_on: SearchOn::Name,
                include_crm: false,
                calendar_event_scope: Default::default(),
                // A name is a strict AND of its words, never a passage match.
                term_matching: TermMatching::All,
                collapse: Some(true),
            };
            Some(
                self.client
                    .search_unified(owner, request, None, ITEMS_PER_NAME)
                    .await
                    .map(|response| {
                        let items = response
                            .results
                            .into_iter()
                            .filter_map(indexed_item)
                            .collect::<Vec<_>>();
                        (items, response.next_cursor.is_some())
                    }),
            )
        };
        let (channels, indexed) = tokio::join!(channels, indexed);
        let mut searched = Searched {
            answer: NameAnswer {
                name: asked.name.clone(),
                unavailable: Vec::new(),
                matches: Vec::new(),
            },
            answered: false,
            error: None,
        };
        for (kinds, result) in [
            (&[ItemKind::Channel][..], channels),
            (
                &[ItemKind::Document, ItemKind::Task, ItemKind::Project][..],
                indexed,
            ),
        ] {
            let wanted = kinds.iter().copied().filter(|kind| wants(*kind));
            match result {
                None => {}
                Some(Ok((items, more))) => {
                    searched.answered = true;
                    let matches: Vec<NameMatch> = items
                        .into_iter()
                        .filter(|(kind, _, _)| wants(*kind))
                        .map(|(kind, id, name)| NameMatch {
                            exact: same_name(&asked.name, &name),
                            name,
                            kind,
                            id,
                            definition_id: None,
                        })
                        .collect();
                    // Newest first, not best match first: past the page, an
                    // item with exactly the name may be missing, unless two
                    // already have it.
                    if more {
                        searched.answer.unavailable.extend(wanted.filter(|kind| {
                            matches
                                .iter()
                                .filter(|item| item.exact && item.kind == *kind)
                                .count()
                                < 2
                        }));
                    }
                    searched.answer.matches.extend(matches);
                }
                Some(Err(error)) => {
                    searched.answer.unavailable.extend(wanted);
                    searched.error = Some(error);
                }
            }
        }
        // Exact matches first.
        searched.answer.matches.sort_by_key(|item| !item.exact);
        searched
    }
}

/// One name's search.
struct Searched {
    answer: NameAnswer,
    /// Whether any search answered.
    answered: bool,
    error: Option<anyhow::Error>,
}

impl Searched {
    /// A name whose search ran out of time: none of its kinds were read.
    fn timed_out(asked: &NameAsked) -> Self {
        Self {
            answer: NameAnswer {
                name: asked.name.clone(),
                unavailable: SEARCHED
                    .iter()
                    .copied()
                    .filter(|kind| asked.kinds.is_empty() || asked.kinds.contains(kind))
                    .collect(),
                matches: Vec::new(),
            },
            answered: false,
            error: Some(anyhow::anyhow!("the name search took too long")),
        }
    }
}

/// A document, task or folder hit, unless it is gone or an initiative's
/// description, which shares its initiative's name.
fn indexed_item(item: UnifiedSearchResponseItem) -> Option<(ItemKind, String, String)> {
    match item {
        UnifiedSearchResponseItem::Document(document) => {
            document
                .metadata
                .as_ref()
                .filter(|metadata| metadata.deleted_at.is_none())?;
            let kind = match document.extra.sub_type {
                Some(DocumentSubType::Task) => ItemKind::Task,
                Some(DocumentSubType::InitiativeDescription) => return None,
                Some(DocumentSubType::Snippet | DocumentSubType::Skill) | None => {
                    ItemKind::Document
                }
            };
            Some((kind, document.extra.id.to_string(), document.extra.name))
        }
        UnifiedSearchResponseItem::Project(project) => {
            project
                .metadata
                .as_ref()
                .filter(|metadata| metadata.deleted_at.is_none())?;
            Some((
                ItemKind::Project,
                project.extra.id.to_string(),
                project.extra.name,
            ))
        }
        _ => None,
    }
}

// Object-safe (`async_trait`): the drafter holds it as `Arc<dyn NameLookups>`.
#[async_trait::async_trait]
impl NameLookups for SearchNames {
    fn kinds(&self) -> &[ItemKind] {
        SEARCHED
    }

    async fn look_up(
        &self,
        owner: &MacroUserIdStr<'static>,
        names: &[NameAsked],
    ) -> Result<NameAnswers, NameLookupError> {
        // One deadline for every name, so a name answered in time is kept
        // when a later one runs out of it. Futures built up front: a stream
        // `map` closure that borrows the names isn't `Send` enough for
        // `async_trait`.
        let deadline = tokio::time::Instant::now() + self.timeout;
        let searches: Vec<_> = names
            .iter()
            .map(|asked| async move {
                tokio::time::timeout_at(deadline, self.search(owner.as_ref(), asked))
                    .await
                    .unwrap_or_else(|_| Searched::timed_out(asked))
            })
            .collect();
        let searched: Vec<Searched> = futures::stream::iter(searches)
            .buffered(NAMES_AT_ONCE)
            .collect()
            .await;
        let mut answers = NameAnswers::default();
        let mut answered = false;
        let mut error = None;
        let mut unanswered = 0;
        for name in searched {
            answered |= name.answered;
            if !name.answer.unavailable.is_empty() {
                unanswered += 1;
            }
            error = error.or(name.error);
            answers.answers.push(name.answer);
        }
        match error {
            Some(error) if !answered => Err(NameLookupError(error.into_rootcause())),
            Some(error) => {
                tracing::warn!(
                    error = %error,
                    names = unanswered,
                    "some names couldn't be searched for every kind"
                );
                Ok(answers)
            }
            None => Ok(answers),
        }
    }
}
