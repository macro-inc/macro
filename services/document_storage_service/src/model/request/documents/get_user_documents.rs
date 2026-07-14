#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug)]
pub struct GetUserDocumentsQueryParams {
    /// The max number of items to return
    pub limit: Option<i64>,
    /// The offset to start from
    pub offset: Option<i64>,
    /// The file type to filter by. Default all.
    pub file_type: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug)]
pub struct GetUserDocumentsParams {
    /// The max number of items to return
    pub limit: i64,
    /// The offset to start from
    pub offset: i64,
    /// The file type to filter by. Default all.
    pub file_type: Option<String>,
}

impl GetUserDocumentsParams {
    pub fn from_query_params(params: GetUserDocumentsQueryParams) -> Self {
        Self {
            limit: params.limit.unwrap_or(10),
            offset: params.offset.unwrap_or(0),
            file_type: params.file_type,
        }
    }
}
