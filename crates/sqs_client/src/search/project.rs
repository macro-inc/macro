/// Requests project reconciliation through the SQS backfill path.
///
/// Project lifecycle updates use Kafka. This payload remains available only so
/// search backfills can use `index_override` to target an alternate index.
#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq, Eq)]
pub struct UpsertProject {
    /// The project id
    pub project_id: String,
    /// Optional override for the target OpenSearch index
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub index_override: Option<String>,
}
