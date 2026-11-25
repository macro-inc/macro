use serde::{Deserialize, Serialize};

/// Viewer-relative share provenance filter for shared items.
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ShareSource {
    /// Shared directly with the requesting viewer (direct person share, `@mention`, or DM).
    Direct,
    /// Shared via a team or non-DM channel, and not also shared directly.
    TeamOrChannel,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::{document::DocumentLiteral, project::ProjectLiteral};

    #[test]
    fn share_source_round_trips_in_document_and_project_literals() {
        let doc_direct = DocumentLiteral::ShareSource(ShareSource::Direct);
        let doc_json = serde_json::to_value(&doc_direct).unwrap();
        assert_eq!(doc_json, serde_json::json!({ "ss": "direct" }));
        assert!(matches!(
            serde_json::from_value::<DocumentLiteral>(doc_json).unwrap(),
            DocumentLiteral::ShareSource(ShareSource::Direct)
        ));

        let proj_team = ProjectLiteral::ShareSource(ShareSource::TeamOrChannel);
        let proj_json = serde_json::to_value(&proj_team).unwrap();
        assert_eq!(proj_json, serde_json::json!({ "ss": "team_or_channel" }));
        assert!(matches!(
            serde_json::from_value::<ProjectLiteral>(proj_json).unwrap(),
            ProjectLiteral::ShareSource(ShareSource::TeamOrChannel)
        ));
    }
}
