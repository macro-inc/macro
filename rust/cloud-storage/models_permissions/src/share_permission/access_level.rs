use schemars::JsonSchema;
use utoipa::ToSchema;

#[derive(
    serde::Serialize,
    serde::Deserialize,
    Eq,
    PartialEq,
    Debug,
    ToSchema,
    JsonSchema,
    Clone,
    Copy,
    PartialOrd,
    sqlx::Type,
    strum::EnumString,
    strum::Display,
    std::cmp::Ord,
)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "snake_case")]
#[sqlx(type_name = "\"AccessLevel\"", rename_all = "lowercase")]
/// Ordered from least to most access top -> bottom
pub enum AccessLevel {
    View,
    Comment,
    Edit,
    Owner,
}

#[derive(Debug)]
pub struct ViewAccessLevel;
#[derive(Debug)]
pub struct CommentAccessLevel;
#[derive(Debug)]
pub struct EditAccessLevel;
#[derive(Debug)]
pub struct OwnerAccessLevel;

#[cfg(test)]
mod tests {
    use crate::share_permission::access_level::AccessLevel;

    #[test]
    fn test_access_level_ordering() {
        let mut access_levels = vec![
            AccessLevel::Edit,
            AccessLevel::Comment,
            AccessLevel::Owner,
            AccessLevel::View,
            AccessLevel::View,
        ];

        access_levels.sort();

        assert_eq!(
            access_levels,
            vec![
                AccessLevel::View,
                AccessLevel::View,
                AccessLevel::Comment,
                AccessLevel::Edit,
                AccessLevel::Owner,
            ]
        );

        assert!(AccessLevel::Owner > AccessLevel::Edit);
        assert!(AccessLevel::Owner > AccessLevel::Comment);
        assert!(AccessLevel::Owner > AccessLevel::View);

        assert!(AccessLevel::Edit > AccessLevel::Comment);
        assert!(AccessLevel::Edit > AccessLevel::View);

        assert!(AccessLevel::Comment > AccessLevel::View);
    }
}
