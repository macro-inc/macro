//! Shared matcher contract, with upstream global scan operations.
pub use lexical_rich_nodes::utils::matcher::{Match, Matcher, RegexMatcher};
/// Stateless equivalent of repeated global matching over the original input.
pub fn find_all(regex: &RegexMatcher, text: &str) -> Vec<Match> {
    regex.find_all(text)
}
/// Global replacement without retaining lastIndex between calls.
pub fn replace_all(
    regex: &RegexMatcher,
    text: &str,
    mut replace: impl FnMut(&Match) -> String,
) -> String {
    let mut output = String::new();
    let mut end = 0;
    for m in find_all(regex, text) {
        output.push_str(&crate::util::slice(text, end, m.index.get() as usize));
        output.push_str(&replace(&m));
        end = m.end().get() as usize;
    }
    output.push_str(&crate::util::slice(text, end, crate::util::len(text)));
    output
}
#[cfg(test)]
mod test;
