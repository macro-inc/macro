//! Statement templates.
//!
//! Every statement the driver runs is a template: SQL text with `?`
//! placeholders, whose values are bound separately. A [`Sql`] template is
//! built only from `&'static str` fragments (text written in this crate's
//! source) and other [`Sql`] templates. A `String`, a borrowed `&str` and a
//! number have no [`SqlPart`] implementation, so text or numbers that exist
//! only at run time (a record field, a search term, a file path, a name read
//! back from the database, a limit or an ID) cannot be pushed into one: the
//! compiler rejects it. That is what lets slow-query telemetry send a [`Sql`]
//! template's text.
//!
//! Numbers enter a template only as structure: how many placeholders a list
//! has ([`Sql::placeholders`]), a placeholder's position ([`Sql::placeholder`]),
//! a generated name's position, handed out in order by [`Ordinals`]
//! ([`Sql::numbered`]), or a constant the compiler evaluates
//! ([`Sql::constant`]). A value always stays bound. The driver refuses to run
//! a statement whose placeholders do not match the values bound with it, so a
//! placeholder's number is always a bind position; a generated name's number
//! counts the names before it, since [`Ordinals`] has no way to start
//! anywhere but zero or to skip.
//!
//! ```
//! use cache_turso::sql::Sql;
//!
//! let mut sql = Sql::new();
//! sql.push("SELECT value FROM records WHERE id IN (")
//!     .push(Sql::placeholders(3))
//!     .push(") LIMIT ")
//!     .push(Sql::placeholder(4));
//! assert_eq!(sql.as_str(), "SELECT value FROM records WHERE id IN (?, ?, ?) LIMIT ?4");
//! ```
//!
//! Text built at run time does not compile:
//!
//! ```compile_fail,E0597
//! use cache_turso::sql::Sql;
//!
//! let typed = String::from("x' OR 1 = 1 --");
//! Sql::new().push(typed.as_str());
//! ```
//!
//! ```compile_fail,E0277
//! use cache_turso::sql::Sql;
//!
//! Sql::new().push(String::from("SELECT 1"));
//! ```
//!
//! Nor does a number known only at run time:
//!
//! ```compile_fail,E0277
//! use cache_turso::sql::Sql;
//!
//! let limit: usize = std::env::args().count();
//! Sql::new().push("LIMIT ").push(limit);
//! ```
//!
//! ```compile_fail,E0435
//! use cache_turso::sql::Sql;
//!
//! fn limited(limit: i64) -> Sql {
//!     Sql::constant::<limit>()
//! }
//! ```
//!
//! A generated name's number comes only from [`Ordinals`], never from a
//! number the caller has:
//!
//! ```compile_fail,E0308
//! use cache_turso::sql::Sql;
//!
//! let id: usize = std::env::args().count();
//! Sql::numbered("w", id);
//! ```
//!
//! A [`Template`], what the driver runs, is made only from a `&'static str`,
//! a [`Sql`], or the crate-private `UnreportedSql`:
//!
//! ```compile_fail,E0277
//! use cache_turso::sql::Template;
//!
//! let text = String::from("SELECT 1");
//! let _: Template<'_> = (&text).into();
//! ```
//!
//! ```compile_fail,E0597
//! use cache_turso::sql::Template;
//!
//! let text = String::from("SELECT 1");
//! let _: Template<'_> = text.as_str().into();
//! ```
//!
//! `UnreportedSql` is for statements that must embed text from elsewhere (SQL
//! compiled by `database_sql` from a caller's query, a name read back from
//! `sqlite_schema`). It runs like any other statement, but its text never
//! reaches telemetry: only its fingerprint does. Only the conversions in this
//! module decide whether a statement's text may be sent.
//!
//! A `&'static str` can still be made at run time by leaking a `String` or
//! keeping one in a `static`. The ast-grep rule
//! `rust-cache-turso-no-runtime-static-text` forbids both in this crate.

use std::fmt::Write as _;

/// Positions for the names a statement generates, handed out in order from
/// zero. There is no other way to make an [`Ordinal`], so its number counts
/// the names generated before it and never carries a value.
#[derive(Debug, Default)]
pub struct Ordinals {
    next: usize,
}

impl Ordinals {
    /// Positions starting at zero.
    pub fn new() -> Self {
        Self::default()
    }

    /// The next position: 0 first, then 1, and so on.
    #[must_use = "an ordinal only counts names that use it"]
    pub fn take(&mut self) -> Ordinal {
        let ordinal = Ordinal(self.next);
        self.next += 1;
        ordinal
    }
}

/// One position from [`Ordinals`]. Copy it to name the same thing twice.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ordinal(usize);

/// A statement template built only from text written in this crate.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct Sql {
    text: String,
}

impl From<&'static str> for Sql {
    fn from(text: &'static str) -> Self {
        let mut sql = Self::new();
        sql.push(text);
        sql
    }
}

impl std::fmt::Display for Sql {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.text)
    }
}

impl Sql {
    /// An empty template.
    pub fn new() -> Self {
        Self::default()
    }

    /// Appends `part` and returns the template, for chaining.
    pub fn push(&mut self, part: impl SqlPart) -> &mut Self {
        part.write_to(self);
        self
    }

    /// `count` anonymous placeholders separated by commas: `?, ?, ?`.
    pub fn placeholders(count: usize) -> Self {
        Self::repeat("?", count, ", ")
    }

    /// The numbered placeholder `?index`.
    pub fn placeholder(index: usize) -> Self {
        let mut sql = Self::new();
        let _ = write!(sql.text, "?{index}");
        sql
    }

    /// Numbered placeholders `?start` up to `?(start + count - 1)`, separated by
    /// commas.
    pub fn numbered_placeholders(start: usize, count: usize) -> Self {
        let mut sql = Self::new();
        for index in start..start + count {
            if index > start {
                sql.text.push_str(", ");
            }
            let _ = write!(sql.text, "?{index}");
        }
        sql
    }

    /// A generated name: `prefix` followed by its position, such as `expr_3`.
    pub fn numbered(prefix: &'static str, ordinal: Ordinal) -> Self {
        let mut sql = Self::new();
        let _ = write!(sql.text, "{prefix}{}", ordinal.0);
        sql
    }

    /// A number the compiler knows, such as a fixed cap: `VALUE` must be a
    /// constant, so a runtime value cannot reach the text this way.
    pub fn constant<const VALUE: i64>() -> Self {
        let mut sql = Self::new();
        let _ = write!(sql.text, "{VALUE}");
        sql
    }

    /// `count` copies of `part` separated by `separator`.
    pub fn repeat(part: impl SqlPart, count: usize, separator: &'static str) -> Self {
        let mut sql = Self::new();
        for index in 0..count {
            if index > 0 {
                sql.text.push_str(separator);
            }
            part.write_to(&mut sql);
        }
        sql
    }

    /// `parts` separated by `separator`.
    pub fn join<P: SqlPart>(parts: impl IntoIterator<Item = P>, separator: &'static str) -> Self {
        let mut sql = Self::new();
        for (index, part) in parts.into_iter().enumerate() {
            if index > 0 {
                sql.text.push_str(separator);
            }
            part.write_to(&mut sql);
        }
        sql
    }

    /// The template's text.
    pub fn as_str(&self) -> &str {
        &self.text
    }

    /// Whether the template has no text.
    pub fn is_empty(&self) -> bool {
        self.text.is_empty()
    }

    #[doc(hidden)]
    pub fn fill(&mut self, template: &'static str, parts: &[(&'static str, &dyn SqlPart)]) {
        let bytes = template.as_bytes();
        let mut start = 0;
        let mut index = 0;
        while index < bytes.len() {
            if bytes[index] != b'{' {
                index += 1;
                continue;
            }
            let end = hole_end(bytes, index).unwrap_or(index);
            self.text.push_str(&template[start..index]);
            let name = &template[index + 1..end];
            if let Some((_, part)) = parts.iter().find(|(candidate, _)| *candidate == name) {
                part.write_to(self);
            }
            index = end + 1;
            start = index;
        }
        self.text.push_str(&template[start..]);
    }
}

mod sealed {
    pub trait Sealed {}
    impl Sealed for &'static str {}
    impl Sealed for super::Sql {}
    impl Sealed for &super::Sql {}
}

/// Something that can be appended to a [`Sql`] template: text that exists
/// before the program runs. Sealed: no other type can implement it.
pub trait SqlPart: sealed::Sealed {
    /// Appends this part's text.
    fn write_to(&self, sql: &mut Sql);
}

impl SqlPart for &'static str {
    fn write_to(&self, sql: &mut Sql) {
        sql.text.push_str(self);
    }
}

impl SqlPart for Sql {
    fn write_to(&self, sql: &mut Sql) {
        sql.text.push_str(&self.text);
    }
}

impl SqlPart for &Sql {
    fn write_to(&self, sql: &mut Sql) {
        sql.text.push_str(&self.text);
    }
}

/// A statement that embeds text from outside this crate's source. It runs like
/// a [`Sql`] template, but telemetry never sends its text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct UnreportedSql(String);

impl UnreportedSql {
    pub(crate) fn new(text: String) -> Self {
        Self(text)
    }

    #[cfg(test)]
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

/// Whether a statement's text may leave the engine. Only the conversions into
/// [`Template`] below make one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Reportable(bool);

impl Reportable {
    /// Whether the text was built only from this crate's own fragments.
    pub(crate) fn text_may_be_sent(self) -> bool {
        self.0
    }
}

/// What the driver runs: a statement's text, and whether that text may be
/// reported. Made only from a `&'static str`, a [`Sql`] or an
/// `UnreportedSql`.
#[derive(Clone, Copy, Debug)]
pub struct Template<'s> {
    text: &'s str,
    reportable: Reportable,
}

impl<'s> Template<'s> {
    pub(crate) fn text(self) -> &'s str {
        self.text
    }

    pub(crate) fn reportable(self) -> Reportable {
        self.reportable
    }
}

impl From<&'static str> for Template<'static> {
    fn from(text: &'static str) -> Self {
        Self {
            text,
            reportable: Reportable(true),
        }
    }
}

impl<'s> From<&'s Sql> for Template<'s> {
    fn from(sql: &'s Sql) -> Self {
        Self {
            text: &sql.text,
            reportable: Reportable(true),
        }
    }
}

impl<'s> From<&'s UnreportedSql> for Template<'s> {
    fn from(sql: &'s UnreportedSql) -> Self {
        Self {
            text: &sql.0,
            reportable: Reportable(false),
        }
    }
}

/// Ad-hoc SQL in this crate's unit tests runs unreported, like an
/// [`UnreportedSql`]. Doctests and other crates build without `cfg(test)`, so
/// the `compile_fail` examples above still hold.
#[cfg(test)]
impl<'s> From<&'s String> for Template<'s> {
    fn from(text: &'s String) -> Self {
        Self {
            text,
            reportable: Reportable(false),
        }
    }
}

/// The index of the `}` closing the hole that opens at `start`, when the
/// braces hold a name of letters, digits and underscores.
const fn hole_end(bytes: &[u8], start: usize) -> Option<usize> {
    let mut index = start + 1;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte == b'}' {
            return if index > start + 1 { Some(index) } else { None };
        }
        if !(byte.is_ascii_alphanumeric() || byte == b'_') {
            return None;
        }
        index += 1;
    }
    None
}

const fn same(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut index = 0;
    while index < left.len() {
        if left[index] != right[index] {
            return false;
        }
        index += 1;
    }
    true
}

const fn names_hole(names: &[&str], hole: &[u8]) -> bool {
    let mut index = 0;
    while index < names.len() {
        if same(names[index].as_bytes(), hole) {
            return true;
        }
        index += 1;
    }
    false
}

const fn holds_hole(template: &[u8], name: &[u8]) -> bool {
    let mut index = 0;
    while index < template.len() {
        if template[index] == b'{'
            && let Some(end) = hole_end(template, index)
        {
            let (_, rest) = template.split_at(index + 1);
            let (hole, _) = rest.split_at(end - index - 1);
            if same(hole, name) {
                return true;
            }
        }
        index += 1;
    }
    false
}

/// Whether every `{name}` hole in `template` is one of `names`, every name has
/// a hole, and the template has no other braces. [`sql!`](crate::sql!)
/// checks this while compiling.
#[doc(hidden)]
pub const fn holes_match(template: &str, names: &[&str]) -> bool {
    let bytes = template.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'{' => {
                let Some(end) = hole_end(bytes, index) else {
                    return false;
                };
                let (_, rest) = bytes.split_at(index + 1);
                let (hole, _) = rest.split_at(end - index - 1);
                if !names_hole(names, hole) {
                    return false;
                }
                index = end + 1;
            }
            b'}' => return false,
            _ => index += 1,
        }
    }
    let mut name = 0;
    while name < names.len() {
        if !holds_hole(bytes, names[name].as_bytes()) {
            return false;
        }
        name += 1;
    }
    true
}

/// Builds a [`Sql`](crate::sql::Sql) template from a literal with `{name}`
/// holes and the [`SqlPart`](crate::sql::SqlPart)s that fill them:
/// `sql!("SELECT {columns} FROM {table}", columns, table = TABLE)`. A hole
/// without a part, a part without a hole, or a part that is not a `SqlPart`
/// fails to compile.
///
/// ```compile_fail,E0277
/// let table = String::from("records");
/// cache_turso::sql!("SELECT 1 FROM {table}", table);
/// ```
///
/// ```compile_fail,E0080
/// let table = "records";
/// cache_turso::sql!("SELECT 1 FROM {table} WHERE {missing}", table);
/// ```
#[macro_export]
#[doc(hidden)]
macro_rules! sql {
    ($template:literal $(, $name:ident $(= $value:expr)?)* $(,)?) => {{
        const _: () = assert!(
            $crate::sql::holes_match($template, &[$(stringify!($name)),*]),
            "every hole in a sql! template needs exactly one named part",
        );
        let mut sql = $crate::sql::Sql::new();
        sql.fill(
            $template,
            &[$((stringify!($name), &$crate::sql!(@value $name $($value)?) as &dyn $crate::sql::SqlPart)),*],
        );
        sql
    }};
    (@value $name:ident) => { $name };
    (@value $name:ident $value:expr) => { $value };
}

#[cfg(test)]
mod test;
