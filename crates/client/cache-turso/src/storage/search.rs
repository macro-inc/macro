//! SQL prefilter for the core's Unicode-normalized subsequence search.
//! Values are bound; rows stream to the core for final scoring without a limit.

use super::{SEARCH_LOAD, SearchProfile, SearchQuery, driver, text};

pub(super) fn statement(
    profile: SearchProfile,
    bucket: &str,
    query: &SearchQuery,
) -> (String, driver::Values) {
    let mut sql = SEARCH_LOAD.to_owned();
    let mut values = vec![text(profile.as_str()), text(bucket)];
    let mut tokens = query.tokens().peekable();
    if tokens.peek().is_some() {
        sql.push_str(" AND ((");
        for (index, token) in tokens.enumerate() {
            if index > 0 {
                sql.push_str(" AND ");
            }
            sql.push_str("search_text LIKE ? ESCAPE '\\'");
            let mut pattern = String::from("%");
            for character in token.chars() {
                if matches!(character, '%' | '_' | '\\') {
                    pattern.push('\\');
                }
                pattern.push(character);
                pattern.push('%');
            }
            values.push(text(&pattern));
        }
        // SQLite LIKE stops at NUL, while Rust's matching does not. Include
        // these rare rows as a superset and let the ranker decide the match.
        sql.push_str(") OR instr(search_text, char(0)) > 0)");
    }
    (sql, values)
}
