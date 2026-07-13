#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug)]
pub struct PaginationQueryParams {
    /// The max number of items to return
    pub limit: Option<i64>,
    /// The offset to start from
    pub offset: Option<i64>,
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug)]
pub struct Pagination {
    /// The max number of items to return
    pub limit: i64,
    /// The offset to start from
    pub offset: i64,
}

impl Pagination {
    pub fn from_query_params(params: PaginationQueryParams) -> Self {
        Self {
            limit: params.limit.unwrap_or(10),
            offset: params.offset.unwrap_or(0),
        }
    }
}
