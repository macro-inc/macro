/// Defines which fields to search on
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SearchOn {
    /// Search only on the name/title field
    Name,
    /// Search only on the content field
    #[default]
    Content,
    /// Search on both name and content fields (not yet implemented)
    NameContent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NameOrContent {
    Name,
    Content,
}

impl TryFrom<SearchOn> for NameOrContent {
    type Error = anyhow::Error;

    fn try_from(value: SearchOn) -> Result<Self, Self::Error> {
        match value {
            SearchOn::Name => Ok(Self::Name),
            SearchOn::Content => Ok(Self::Content),
            SearchOn::NameContent => Err(anyhow::anyhow!(
                "NameContent is not a valid value for NameOrContent"
            )),
        }
    }
}
