use models_grouping::{PropertyBucketing, PropertyDateRange, PropertyDateRanges};

/// Transform the selected DATE property into caller-defined ranges.
/// Non-DATE values use the missing-value bucket.
#[derive(async_graphql::InputObject, Clone)]
pub(super) struct GraphqlPropertyBucketing {
    /// Bucketing transformation.
    #[graphql(name = "type")]
    pub kind: GraphqlPropertyBucketingType,
    /// Ordered, contiguous UTC ranges covering every present date.
    pub ranges: Vec<GraphqlDateBucketRange>,
    /// Key for entities whose selected property is absent or cleared.
    pub missing_value_bucket_key: String,
}

/// Supported property-value transformations.
#[derive(async_graphql::Enum, Copy, Clone, Eq, PartialEq)]
pub(super) enum GraphqlPropertyBucketingType {
    /// Caller-defined half-open UTC date ranges.
    DateRanges,
}

/// One named half-open UTC interval.
#[derive(async_graphql::InputObject, Clone)]
pub(super) struct GraphqlDateBucketRange {
    /// Unique group key.
    pub key: String,
    /// Inclusive RFC 3339 UTC start; null means negative infinity.
    pub start: Option<String>,
    /// Exclusive RFC 3339 UTC end; null means positive infinity.
    pub end: Option<String>,
}

impl TryFrom<GraphqlPropertyBucketing> for PropertyBucketing {
    type Error = async_graphql::Error;

    fn try_from(value: GraphqlPropertyBucketing) -> Result<Self, Self::Error> {
        match value.kind {
            GraphqlPropertyBucketingType::DateRanges => {
                let ranges =
                    value
                        .ranges
                        .into_iter()
                        .map(|range| {
                            Ok(PropertyDateRange {
                                key: range.key,
                                start: range.start.map(|start| start.parse()).transpose().map_err(
                                    |error| {
                                        async_graphql::Error::new(format!(
                                            "invalid date range start: {error}"
                                        ))
                                    },
                                )?,
                                end: range.end.map(|end| end.parse()).transpose().map_err(
                                    |error| {
                                        async_graphql::Error::new(format!(
                                            "invalid date range end: {error}"
                                        ))
                                    },
                                )?,
                            })
                        })
                        .collect::<async_graphql::Result<Vec<_>>>()?;
                let ranges = PropertyDateRanges {
                    ranges,
                    missing_value_bucket_key: value.missing_value_bucket_key,
                };
                ranges
                    .validate()
                    .map_err(|error| async_graphql::Error::new(format!("{error:?}")))?;
                Ok(Self::DateRanges(ranges))
            }
        }
    }
}
