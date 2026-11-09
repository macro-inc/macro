//! Portable linkify-it 5.0.2 default schemas, fuzzy matching and ordered stream merge.
//! Expanded regex sources include uc.micro 2.1.0's Unicode classes verbatim.
use lexical_model::Utf16Offset;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    sync::{Arc, LazyLock},
};
/// A regex compilation or pinned-data failure.
#[derive(Debug, thiserror::Error)]
pub enum LinkifyError {
    /// Invalid dynamic TLD expression.
    #[error(transparent)]
    Regex(#[from] regress::Error),
    /// Required pinned expression is missing.
    #[error("missing linkify pattern {0}")]
    MissingPattern(&'static str),
}
/// linkify-it options; default matches the pinned JavaScript package.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    /// Recognize schemeless domains.
    pub fuzzy_link: bool,
    /// Recognize schemeless email addresses.
    pub fuzzy_email: bool,
    /// Recognize schemeless IPv4 addresses.
    #[serde(rename = "fuzzyIP")]
    pub fuzzy_ip: bool,
    /// Stop paths at triple dashes.
    #[serde(rename = "---")]
    pub break_on_three_dashes: bool,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            fuzzy_link: true,
            fuzzy_email: true,
            fuzzy_ip: false,
            break_on_three_dashes: false,
        }
    }
}
/// One normalized match with UTF-16 offsets and untouched source text.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkMatch {
    /// Lowercase protocol, empty for fuzzy domains.
    pub schema: String,
    /// First code-unit index.
    pub index: usize,
    /// Exclusive end code-unit index.
    pub last_index: usize,
    /// Exact input substring.
    pub raw: String,
    /// Display text (the original raw substring for default schemas).
    pub text: String,
    /// Normalized URL.
    pub url: String,
}
#[derive(Clone)]
struct Compiled {
    schema: regress::Regex,
    at_start: regress::Regex,
    host_test: regress::Regex,
    fuzzy: regress::Regex,
    no_ip: regress::Regex,
    email: regress::Regex,
    pretest: regress::Regex,
    http: regress::Regex,
    no_http: regress::Regex,
    mailto: regress::Regex,
}
static PATTERNS: LazyLock<BTreeMap<String, String>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("linkify/patterns.json"))
        .expect("pinned linkify-it 5.0.2 pattern data")
});
fn source(name: &'static str, dashes: bool) -> Result<&'static str, LinkifyError> {
    let key = if dashes {
        format!("{name}_dashes")
    } else {
        name.into()
    };
    PATTERNS
        .get(&key)
        .map(String::as_str)
        .ok_or(LinkifyError::MissingPattern(name))
}
fn compile(tlds: &[String], replaced: bool, dashes: bool) -> Result<Compiled, LinkifyError> {
    let mut tlds = tlds.to_vec();
    if !replaced {
        tlds.push(source("__tlds_2ch", false)?.into());
    }
    tlds.push(source("src_xn", dashes)?.into());
    let tlds = tlds.join("|");
    let regex = |name| {
        regress::Regex::with_flags(&source(name, dashes)?.replace("%TLDS%", &tlds), "i")
            .map_err(LinkifyError::from)
    };
    let make = |value: String| regress::Regex::with_flags(&value, "i").map_err(LinkifyError::from);
    let auth = source("src_auth", dashes)?;
    let path = source("src_path", dashes)?;
    let host = source("src_host_port_strict", dashes)?;
    Ok(Compiled {
        schema: regex("schema_search")?,
        at_start: regex("schema_at_start")?,
        host_test: regex("tpl_host_fuzzy_test")?,
        fuzzy: regex("tpl_link_fuzzy")?,
        no_ip: regex("tpl_link_no_ip_fuzzy")?,
        email: regex("tpl_email_fuzzy")?,
        pretest: make(format!(
            "({})|({})|@",
            source("schema_test", dashes)?,
            source("tpl_host_fuzzy_test", dashes)?.replace("%TLDS%", &tlds)
        ))?,
        http: make(format!(r"^\/\/{auth}{host}{path}"))?,
        no_http: make(format!(
            r"^{auth}(?:localhost|(?:(?:{})\.)+{}){}{}{path}",
            source("src_domain", dashes)?,
            source("src_domain_root", dashes)?,
            source("src_port", dashes)?,
            source("src_host_terminator", dashes)?
        ))?,
        mailto: make(format!(
            "^{}@{}",
            source("src_email_name", dashes)?,
            source("src_host_strict", dashes)?
        ))?,
    })
}
fn defaults() -> Vec<String> {
    PATTERNS
        .get("__tlds_default")
        .expect("pinned TLD data")
        .split('|')
        .map(str::to_owned)
        .collect()
}
static DEFAULT_COMPILED: LazyLock<Arc<Compiled>> = LazyLock::new(|| {
    Arc::new(compile(&defaults(), false, false).expect("validated linkify-it default patterns"))
});
/// Stateful configuration with stateless matching; no regex lastIndex escapes a call.
#[derive(Clone)]
pub struct LinkifyIt {
    options: Options,
    tlds: Vec<String>,
    replaced: bool,
    compiled: Arc<Compiled>,
}
impl Default for LinkifyIt {
    fn default() -> Self {
        Self {
            options: Options::default(),
            tlds: defaults(),
            replaced: false,
            compiled: DEFAULT_COMPILED.clone(),
        }
    }
}
#[derive(Clone, Copy)]
struct Found<'a> {
    schema: &'a str,
    index: usize,
    end: usize,
}
fn choose<'a>(a: Option<Found<'a>>, b: Option<Found<'a>>) -> Option<Found<'a>> {
    match (a, b) {
        (None, b) => b,
        (a, None) => a,
        (Some(a), Some(b)) => Some(
            if a.index < b.index || a.index == b.index && a.end >= b.end {
                a
            } else {
                b
            },
        ),
    }
}
impl LinkifyIt {
    /// Compile the default schemas with explicit fuzzy/dash options.
    pub fn with_options(options: Options) -> Result<Self, LinkifyError> {
        if options == Options::default() {
            return Ok(Self::default());
        }
        let tlds = defaults();
        let compiled = Arc::new(compile(&tlds, false, options.break_on_three_dashes)?);
        Ok(Self {
            options,
            tlds,
            replaced: false,
            compiled,
        })
    }
    /// Build a replaced TLD configuration directly, without compiling defaults first.
    pub fn with_replaced_tlds(options: Options, tlds: &[String]) -> Result<Self, LinkifyError> {
        Ok(Self {
            options,
            tlds: tlds.to_vec(),
            replaced: true,
            compiled: Arc::new(compile(tlds, true, options.break_on_three_dashes)?),
        })
    }
    /// Replace or extend fuzzy-domain TLDs, matching the source's sorting and deduplication.
    pub fn tlds(&mut self, values: &[String], keep_old: bool) -> Result<(), LinkifyError> {
        let mut tlds = if keep_old {
            self.tlds.clone()
        } else {
            Vec::new()
        };
        tlds.extend_from_slice(values);
        if keep_old {
            tlds.sort_by_cached_key(|s| s.encode_utf16().collect::<Vec<_>>());
            tlds.dedup();
            tlds.reverse();
        }
        let replaced = self.replaced || !keep_old;
        let compiled = compile(&tlds, replaced, self.options.break_on_three_dashes)?;
        self.tlds = tlds;
        self.replaced = replaced;
        self.compiled = Arc::new(compiled);
        Ok(())
    }
    fn validate(&self, text: &[u16], schema: &str, pos: usize) -> usize {
        let Some(tail) = text.get(pos..) else {
            return 0;
        };
        let regex = match schema.to_ascii_lowercase().as_str() {
            "http:" | "https:" | "ftp:" => &self.compiled.http,
            "mailto:" => &self.compiled.mailto,
            "//" => {
                if pos >= 3 && matches!(text.get(pos - 3), Some(58 | 47)) {
                    return 0;
                }
                &self.compiled.no_http
            }
            _ => return 0,
        };
        regex
            .find_from_ucs2(tail, 0)
            .next()
            .filter(|m| m.start() == 0)
            .map_or(0, |m| m.end())
    }
    fn streams<'a>(&self, text: &'a str, units: &[u16]) -> [Vec<Found<'a>>; 3] {
        let mut streams = [Vec::new(), Vec::new(), Vec::new()];
        for m in self.compiled.schema.find_from_ucs2(units, 0) {
            let Some(group) = m.group(2) else { continue };
            let schema = String::from_utf16_lossy(&units[group.clone()]);
            let len = self.validate(units, &schema, m.end());
            if len > 0 {
                // Schema spellings are ASCII; choose the original slice to retain casing until normalization.
                let start = units[..group.start].to_vec();
                let byte_start = String::from_utf16_lossy(&start).len();
                let schema = text
                    .get(byte_start..byte_start + schema.len())
                    .unwrap_or("");
                streams[0].push(Found {
                    schema,
                    index: m.start() + m.group(1).map_or(0, |g| g.len()),
                    end: m.end() + len,
                });
            }
        }
        if self.options.fuzzy_email {
            for m in self.compiled.email.find_from_ucs2(units, 0) {
                streams[1].push(Found {
                    schema: "mailto:",
                    index: m.start() + m.group(1).map_or(0, |g| g.len()),
                    end: m.end(),
                });
            }
        }
        if self.options.fuzzy_link {
            let regex = if self.options.fuzzy_ip {
                &self.compiled.fuzzy
            } else {
                &self.compiled.no_ip
            };
            for m in regex.find_from_ucs2(units, 0) {
                streams[2].push(Found {
                    schema: "",
                    index: m.start() + m.group(1).map_or(0, |g| g.len()),
                    end: m.end(),
                });
            }
        }
        streams
    }
    fn normalized(units: &[u16], found: Found<'_>) -> LinkMatch {
        let raw = String::from_utf16_lossy(&units[found.index..found.end]);
        let schema = found.schema.to_ascii_lowercase();
        let url = if schema.is_empty() {
            format!("http://{raw}")
        } else if schema == "mailto:"
            && !raw
                .get(..7)
                .is_some_and(|s| s.eq_ignore_ascii_case("mailto:"))
        {
            format!("mailto:{raw}")
        } else {
            raw.clone()
        };
        LinkMatch {
            schema,
            index: found.index,
            last_index: found.end,
            text: raw.clone(),
            raw,
            url,
        }
    }
    /// Return every non-overlapping match. Ties prefer the longest, then schemed/email/fuzzy.
    pub fn matches(&self, text: &str) -> Vec<LinkMatch> {
        let units: Vec<_> = text.encode_utf16().collect();
        let streams = self.streams(text, &units);
        let mut indexes = [0; 3];
        let mut last = 0;
        let mut result = Vec::new();
        loop {
            let items = [
                streams[0].get(indexes[0]).copied(),
                streams[1].get(indexes[1]).copied(),
                streams[2].get(indexes[2]).copied(),
            ];
            let Some(found) = choose(choose(items[0], items[1]), items[2]) else {
                break;
            };
            let stream = (0..3)
                .find(|&i| {
                    items[i].is_some_and(|f| {
                        f.index == found.index && f.end == found.end && f.schema == found.schema
                    })
                })
                .unwrap_or(0);
            indexes[stream] += 1;
            if found.index < last {
                continue;
            }
            last = found.end;
            result.push(Self::normalized(&units, found));
        }
        result
    }
    /// First match, with UTF-16 offsets.
    pub fn first_match(&self, text: &str) -> Option<LinkMatch> {
        self.matches(text).into_iter().next()
    }
    /// Quick conservative rejection check, preserving the source's false positives.
    pub fn pretest(&self, text: &str) -> bool {
        self.compiled
            .pretest
            .find_from_ucs2(&text.encode_utf16().collect::<Vec<_>>(), 0)
            .next()
            .is_some()
    }
    /// Test schemed, then fuzzy-domain, then fuzzy-email recognition in source order.
    pub fn test(&self, text: &str) -> bool {
        if text.is_empty() {
            return false;
        }
        let units: Vec<_> = text.encode_utf16().collect();
        for m in self.compiled.schema.find_from_ucs2(&units, 0) {
            if let Some(group) = m.group(2)
                && self.validate(&units, &String::from_utf16_lossy(&units[group]), m.end()) > 0
            {
                return true;
            }
        }
        if self.options.fuzzy_link
            && self
                .compiled
                .host_test
                .find_from_ucs2(&units, 0)
                .next()
                .is_some()
        {
            let regex = if self.options.fuzzy_ip {
                &self.compiled.fuzzy
            } else {
                &self.compiled.no_ip
            };
            if regex.find_from_ucs2(&units, 0).next().is_some() {
                return true;
            }
        }
        self.options.fuzzy_email
            && text.contains('@')
            && self
                .compiled
                .email
                .find_from_ucs2(&units, 0)
                .next()
                .is_some()
    }
    /// A fully schemed match beginning at code-unit zero.
    pub fn match_at_start(&self, text: &str) -> Option<LinkMatch> {
        let units: Vec<_> = text.encode_utf16().collect();
        let m = self.compiled.at_start.find_from_ucs2(&units, 0).next()?;
        let group = m.group(2)?;
        let schema = String::from_utf16_lossy(&units[group]);
        let len = self.validate(&units, &schema, m.end());
        (len > 0).then(|| {
            Self::normalized(
                &units,
                Found {
                    schema: &schema,
                    index: m.group(1).map_or(0, |g| g.len()),
                    end: m.end() + len,
                },
            )
        })
    }
}
impl std::fmt::Debug for LinkifyIt {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LinkifyIt")
            .field("options", &self.options)
            .field("tlds", &self.tlds)
            .finish_non_exhaustive()
    }
}
impl super::matcher::Matcher for LinkifyIt {
    fn exec(&self, text: &str) -> Option<super::matcher::Match> {
        let m = self.first_match(text)?;
        super::matcher::Match::new(
            Utf16Offset(m.index as u32),
            text,
            vec![Some(m.raw), Some(m.url), Some(m.text)],
        )
        .ok()
    }
}
#[cfg(test)]
mod test;
