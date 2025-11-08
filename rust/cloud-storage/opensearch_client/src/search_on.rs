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
