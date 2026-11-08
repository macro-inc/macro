//! Shared non-global JavaScript matcher contract for synthetic and regex matches.
use lexical_model::Utf16Offset;
use std::sync::Arc;
/// A JS RegExpMatchArray with UTF-16 positions and optional capture groups.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Match {
    /// Start of group zero.
    pub index: Utf16Offset,
    /// Original input string.
    pub input: Arc<str>,
    groups: Vec<Option<String>>,
}
impl Match {
    /// Build a synthetic match; group zero must have a slot.
    pub fn new(
        index: Utf16Offset,
        input: impl Into<Arc<str>>,
        groups: Vec<Option<String>>,
    ) -> std::result::Result<Self, lexical_model::Error> {
        if groups.is_empty() {
            return Err(lexical_model::Error::Invariant("match requires group zero"));
        }
        Ok(Self {
            index,
            input: input.into(),
            groups,
        })
    }
    /// Capture group; None represents undefined or an out-of-range slot.
    pub fn get(&self, index: usize) -> Option<&str> {
        self.groups.get(index).and_then(Option::as_deref)
    }
    /// Full matched string.
    pub fn full(&self) -> &str {
        self.get(0).unwrap_or("")
    }
    /// Full match length in code units.
    pub fn full_len16(&self) -> u32 {
        self.full().encode_utf16().count() as u32
    }
    /// Exclusive end position.
    pub fn end(&self) -> Utf16Offset {
        Utf16Offset(self.index.get() + self.full_len16())
    }
    /// Number of capture slots including zero.
    pub fn group_count(&self) -> usize {
        self.groups.len()
    }
    /// Change a synthetic capture, extending with undefined slots if needed.
    pub fn set(&mut self, index: usize, value: Option<String>) {
        if index >= self.groups.len() {
            self.groups.resize(index + 1, None);
        }
        self.groups[index] = value;
    }
}
/// Stateless equivalent of non-global RegExp.exec, including synthetic matches.
pub trait Matcher: Send + Sync + std::fmt::Debug {
    /// First match from code-unit zero.
    fn exec(&self, text: &str) -> Option<Match>;
    /// Whether a match exists.
    fn test(&self, text: &str) -> bool {
        self.exec(text).is_some()
    }
}
/// Invalid flags or expression syntax.
#[derive(Debug, thiserror::Error)]
pub enum MatcherError {
    /// Only unique i, m, s and u flags are accepted; global/sticky arrays differ.
    #[error("invalid non-global matcher flags: {0}")]
    InvalidFlags(String),
    /// ECMAScript parser error.
    #[error(transparent)]
    Regex(#[from] regress::Error),
}
/// ECMAScript regex matcher with UTF-16 offsets and JS undefined captures.
#[derive(Clone, Debug)]
pub struct RegexMatcher {
    regex: regress::Regex,
    source: Box<str>,
    flags: Box<str>,
}
impl RegexMatcher {
    /// Compile a stateless non-global regex.
    pub fn new(source: &str, flags: &str) -> Result<Self, MatcherError> {
        let mut seen = std::collections::HashSet::new();
        if flags
            .chars()
            .any(|ch| !matches!(ch, 'i' | 'm' | 's' | 'u') || !seen.insert(ch))
        {
            return Err(MatcherError::InvalidFlags(flags.into()));
        }
        Ok(Self {
            regex: regress::Regex::with_flags(source, flags)?,
            source: source.into(),
            flags: flags.into(),
        })
    }
    /// Original pattern source.
    pub fn source(&self) -> &str {
        &self.source
    }
    /// Original flags.
    pub fn flags(&self) -> &str {
        &self.flags
    }
}
impl RegexMatcher {
    /// Execute from a UTF-16 offset while keeping anchors and captures on the original input.
    pub fn exec_from(&self, text: &str, start: Utf16Offset) -> Option<Match> {
        let units: Vec<_> = text.encode_utf16().collect();
        if start.get() as usize > units.len() {
            return None;
        }
        let m = if self.flags.contains('u') {
            self.regex
                .find_from_utf16(&units, start.get() as usize)
                .next()
        } else {
            self.regex
                .find_from_ucs2(&units, start.get() as usize)
                .next()
        }?;
        let mut groups = vec![Some(String::from_utf16_lossy(&units[m.range()]))];
        groups.extend(
            m.captures
                .iter()
                .map(|range| range.clone().map(|r| String::from_utf16_lossy(&units[r]))),
        );
        Match::new(Utf16Offset(m.start() as u32), text, groups).ok()
    }
}
impl RegexMatcher {
    /// Equivalent to matchAll with explicit JS empty-match advancement.
    pub fn find_all(&self, text: &str) -> Vec<Match> {
        let units: Vec<_> = text.encode_utf16().collect();
        let mut start = 0;
        let mut out = Vec::new();
        while let Some(m) = self.exec_from(text, Utf16Offset(start as u32)) {
            start = m.end().get() as usize;
            if m.full_len16() == 0 {
                start += if self.flags.contains('u')
                    && units
                        .get(start)
                        .is_some_and(|u| (0xd800..=0xdbff).contains(u))
                    && units
                        .get(start + 1)
                        .is_some_and(|u| (0xdc00..=0xdfff).contains(u))
                {
                    2
                } else {
                    1
                };
            }
            out.push(m);
            if start > units.len() {
                break;
            }
        }
        out
    }
}
impl Matcher for RegexMatcher {
    fn exec(&self, text: &str) -> Option<Match> {
        self.exec_from(text, Utf16Offset::ZERO)
    }
}
#[cfg(test)]
mod test;
