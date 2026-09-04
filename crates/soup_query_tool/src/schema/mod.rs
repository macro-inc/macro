//! Query-only GraphQL schema executed by QuerySoup.

use std::sync::LazyLock;

use async_graphql::{EmptyMutation, EmptySubscription, SDLExportOptions, Schema};

use crate::schema::query_root::Query;

pub(crate) mod input;
pub(crate) mod output;
pub(crate) mod query_root;

#[cfg(test)]
mod test;

/// The executed tool schema.
pub(crate) type SoupSchema = Schema<Query, EmptyMutation, EmptySubscription>;

/// Built once per process. Introspection stays on.
pub(crate) static SCHEMA: LazyLock<SoupSchema> = LazyLock::new(|| {
    Schema::build(Query, EmptyMutation, EmptySubscription)
        .limit_depth(12)
        .limit_complexity(1_000)
        .limit_recursive_depth(8)
        .finish()
});

/// Compact-enough SDL of the executed schema.
pub fn compact_sdl() -> String {
    SCHEMA.sdl_with_options(SDLExportOptions::new().prefer_single_line_descriptions())
}

pub(crate) mod description {
    use std::sync::LazyLock;

    /// Tool card: rules + executed SDL + examples.
    pub fn text() -> &'static str {
        &TEXT
    }

    static TEXT: LazyLock<String> = LazyLock::new(|| {
        format!(
            "{rules}\n\nSchema\n```graphql\n{sdl}\n```\n\nExamples\n```graphql\n{examples}\n```",
            rules = include_str!("../../description/rules.md"),
            sdl = super::compact_sdl(),
            examples = include_str!("../../description/examples.graphql"),
        )
    });
}
