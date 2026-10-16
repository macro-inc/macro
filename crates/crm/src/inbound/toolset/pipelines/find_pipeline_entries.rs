//! FindPipelineEntries: the deals in a pipeline, or a record's deals in every
//! pipeline.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{PipelineToolContext, ToolEntry, ToolFieldValue, pairs, workflow_error};
use crate::domain::pipeline_workflows::{EntryQuery, FoundEntries, PipelineWorkflowService};

/// Entries returned when `limit` is left out.
const DEFAULT_LIMIT: u16 = 50;
/// Most entries one call returns.
const MAX_LIMIT: u16 = 200;

/// Read entries of a pipeline.
#[derive(Debug, Clone, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "FindPipelineEntries",
    description = "Find deals (entries) in a CRM pipeline: which companies or contacts are in which stage, who owns them, their revenue and other fields. Filter by field values (e.g. Stage is Demo or Trial, Owner is me), by company or contact name/domain/email with `search`, or by record id; sort by any field (Stage sorts in pipeline order). Returns each entry's entryId, the record it tracks (id and name) and its filled-in fields, plus, over every match, the count per stage (and per option of each single-select field) and the total of each number field such as Revenue: use these for questions like \"how many deals are in Negotiation\" or \"what is the pipeline worth\". To find where a company or contact is across all pipelines (\"what stage is Acme in?\"), leave out pipelineId and pass its name as `search` (or its recordIds). Get pipeline ids and field names from ListPipelines."
)]
pub struct FindPipelineEntries {
    /// The pipeline to read.
    #[schemars(
        description = "The pipeline's id from ListPipelines. Leave it out to look in every pipeline by `search` or `recordIds`; filters and sorting need a pipelineId."
    )]
    #[serde(default)]
    pub pipeline_id: Option<Uuid>,
    /// Field filters.
    #[schemars(
        description = "Only entries whose fields hold these values; all filters must match. Options and people match exactly (labels ignore case), text matches a substring, dates match the day. Example: [{\"field\": \"Stage\", \"values\": [\"Demo\", \"Trial\"]}, {\"field\": \"Owner\", \"value\": \"me\"}]."
    )]
    #[serde(default)]
    pub filters: Vec<ToolFieldValue>,
    /// Record ids.
    #[schemars(description = "Only entries tracking these CRM company or contact ids.")]
    #[serde(default)]
    pub record_ids: Vec<Uuid>,
    /// Record search text.
    #[schemars(
        description = "Text the tracked company's name or domain, or the contact's name or email, must contain, ignoring case (e.g. \"acme\")."
    )]
    #[serde(default)]
    pub search: Option<String>,
    /// The field to sort by.
    #[schemars(
        description = "A field name to order entries by, e.g. \"Revenue\" or \"Stage\". Empty fields come last."
    )]
    #[serde(default)]
    pub sort_by: Option<String>,
    /// Largest first.
    #[schemars(description = "Sort largest, latest or furthest stage first. Defaults to false.")]
    #[serde(default)]
    pub descending: Option<bool>,
    /// Most entries to return.
    #[schemars(description = "Most entries to return. Defaults to 50; max 200.")]
    #[serde(default)]
    pub limit: Option<u16>,
}

/// One pipeline's matching entries.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolPipelineEntries {
    /// The pipeline's id.
    pub pipeline_id: Uuid,
    /// The pipeline's name.
    pub pipeline_name: String,
    /// The pipeline's version when read; pass as `baseVersion` to
    /// UpdatePipelineEntries to refuse the update if it changed since.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<i64>,
    /// The entries.
    pub entries: Vec<ToolEntry>,
}

/// How many matching entries hold one option.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolOptionCount {
    /// The option's label.
    pub label: String,
    /// Matching entries holding it.
    pub count: usize,
}

/// Matching entries per option of one single-select field, such as Stage.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolOptionCounts {
    /// The field.
    pub field: String,
    /// Every option in order with its count.
    pub counts: Vec<ToolOptionCount>,
    /// Matching entries with the field empty.
    pub empty: usize,
}

/// The sum of a number field over the matching entries.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolTotal {
    /// The field.
    pub field: String,
    /// The sum.
    pub sum: f64,
}

/// The entries found.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FindPipelineEntriesResponse {
    /// Matching entries, grouped by pipeline.
    pub pipelines: Vec<ToolPipelineEntries>,
    /// How many entries matched; more than returned when `limit` cut them.
    pub matched: usize,
    /// Whether every entry of the pipeline was read. When false the pipeline
    /// is too large to read whole, and counts and totals are partial.
    pub complete: bool,
    /// Matching entries per stage (and per option of every other
    /// single-select field), over all matches.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub counts: Vec<ToolOptionCounts>,
    /// The sum of every number field, such as Revenue, over all matches.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub totals: Vec<ToolTotal>,
    /// What was found.
    pub summary: String,
}

impl ToolAnnotated for FindPipelineEntries {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Find pipeline entries");
}

#[async_trait]
impl<Workflows: PipelineWorkflowService> AsyncTool<PipelineToolContext<Workflows>>
    for FindPipelineEntries
{
    type Output = FindPipelineEntriesResponse;

    #[tracing::instrument(skip_all, fields(user_id = ?request_context.user_id), err)]
    async fn call(
        &self,
        context: ServiceContext<PipelineToolContext<Workflows>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let viewer = context.viewer(request_context.user_id);
        let limit = usize::from(self.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT));
        let Some(pipeline_id) = self.pipeline_id else {
            let search = self
                .search
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty());
            if !self.filters.is_empty() || self.sort_by.is_some() {
                return Err(ToolCallError {
                    description: "Filters and sorting apply to one pipeline: pass its pipelineId \
                                  from ListPipelines."
                        .to_owned(),
                    internal_error: anyhow::anyhow!("filters without a pipeline"),
                });
            }
            let found = match (search, self.record_ids.is_empty()) {
                (Some(search), _) => context.service.search_entries(&viewer, search, limit).await,
                (None, false) => {
                    context
                        .service
                        .record_entries(&viewer, &self.record_ids)
                        .await
                }
                (None, true) => {
                    return Err(ToolCallError {
                        description: "Pass a pipelineId from ListPipelines, or a `search` or \
                                      recordIds to look in every pipeline."
                            .to_owned(),
                        internal_error: anyhow::anyhow!("nothing to look for"),
                    });
                }
            }
            .map_err(workflow_error)?;
            let found: Vec<_> = found
                .into_iter()
                .map(|mut group| {
                    if !self.record_ids.is_empty() {
                        group
                            .entries
                            .retain(|entry| self.record_ids.contains(&entry.record.id));
                    }
                    group
                })
                .filter(|group| !group.entries.is_empty())
                .collect();
            let matched = found.iter().map(|group| group.entries.len()).sum();
            let found: Vec<_> = found
                .into_iter()
                .map(|mut group| {
                    group.entries.truncate(limit);
                    group
                })
                .collect();
            let summary = match matched {
                0 => "No entry in any of the user's pipelines matches.".to_owned(),
                count => format!("Found {count} entries in {} pipelines.", found.len()),
            };
            return Ok(FindPipelineEntriesResponse {
                pipelines: found
                    .iter()
                    .map(|group| ToolPipelineEntries {
                        pipeline_id: group.pipeline.pipeline.id,
                        pipeline_name: group.pipeline.pipeline.name.clone(),
                        version: None,
                        entries: group.entries.iter().map(ToolEntry::from).collect(),
                    })
                    .collect(),
                matched,
                complete: true,
                counts: Vec::new(),
                totals: Vec::new(),
                summary,
            });
        };

        let found = context
            .service
            .find(
                &viewer,
                pipeline_id,
                EntryQuery {
                    filters: pairs(&self.filters),
                    records: self.record_ids.clone(),
                    search: self
                        .search
                        .clone()
                        .filter(|search| !search.trim().is_empty()),
                    sort: self
                        .sort_by
                        .clone()
                        .map(|field| (field, self.descending.unwrap_or(false))),
                    limit,
                },
            )
            .await
            .map_err(workflow_error)?;
        Ok(response(found))
    }
}

fn response(found: FoundEntries) -> FindPipelineEntriesResponse {
    let name = found.pipeline.pipeline.pipeline.name.clone();
    let mut summary = match (found.matched, found.entries.len()) {
        (0, _) => format!("No entries in \"{name}\" match."),
        (matched, shown) if shown < matched => {
            format!("Showing {shown} of {matched} matching entries in \"{name}\".")
        }
        (matched, _) => format!("Found {matched} matching entries in \"{name}\"."),
    };
    if !found.complete {
        summary.push_str(
            " The pipeline is too large to read whole, so these results, counts and totals \
             cover only part of it: say so, and narrow the request.",
        );
    }
    FindPipelineEntriesResponse {
        pipelines: vec![ToolPipelineEntries {
            pipeline_id: found.pipeline.pipeline.pipeline.id,
            pipeline_name: name,
            version: Some(found.pipeline.version.0),
            entries: found.entries.iter().map(ToolEntry::from).collect(),
        }],
        matched: found.matched,
        complete: found.complete,
        counts: found
            .counts
            .into_iter()
            .map(|counts| ToolOptionCounts {
                field: counts.field,
                counts: counts
                    .counts
                    .into_iter()
                    .map(|(label, count)| ToolOptionCount { label, count })
                    .collect(),
                empty: counts.empty,
            })
            .collect(),
        totals: found
            .totals
            .into_iter()
            .map(|(field, sum)| ToolTotal { field, sum })
            .collect(),
        summary,
    }
}
