/// Validate an optional GraphQL page-size argument: apply `default` when
/// absent, reject non-positive values, and refuse anything above `max`.
pub fn parse_limit(limit: Option<i32>, default: i32, max: i32) -> async_graphql::Result<u32> {
    let limit = limit.unwrap_or(default);
    if limit <= 0 {
        return Err(async_graphql::Error::new("limit must be positive"));
    }
    if limit > max {
        return Err(async_graphql::Error::new(format!(
            "limit must not exceed {max}"
        )));
    }
    Ok(u32::try_from(limit).expect("positive GraphQL Int fits in u32"))
}
