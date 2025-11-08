use crate::{
    DOCUMENTS_INDEX, Result, error::OpensearchClientError, search::documents::DocumentIndex,
};

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct DocumentHit {
    _source: DocumentIndex,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct DocumentHits {
    hits: Vec<DocumentHit>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct SearchDocumentResponse {
    pub hits: DocumentHits,
}

/// Given a specific document id, this function will return the document if it exists
pub(crate) async fn get_document_by_id(
    client: &opensearch::OpenSearch,
    document_id: &str,
) -> Result<Vec<DocumentIndex>> {
    let response = client
        .search(opensearch::SearchParts::Index(&[DOCUMENTS_INDEX]))
        .body(serde_json::json!({
            "query": {
                "bool": {
                    "must": [
                        {
                            "term": {
                                "document_id": document_id
                            }
                        }
                    ]
                }
            },
        }))
        .send()
        .await
        .map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            method: Some("get_document_by_id".to_string()),
        })?;

    let result = response
        .json::<SearchDocumentResponse>()
        .await
        .map_err(|e| OpensearchClientError::DeserializationFailed {
            details: e.to_string(),
            method: Some("search_documents".to_string()),
        })?;

    if result.hits.hits.is_empty() {
        return Ok(vec![]);
    }

    println!("{result:?}");

    Ok(result
        .hits
        .hits
        .into_iter()
        .map(|hit| hit._source)
        .collect())
}
