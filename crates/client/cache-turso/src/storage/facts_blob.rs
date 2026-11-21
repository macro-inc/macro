//! One complete index document's facts as a single value on its
//! `index_documents` row, so a candidate's predicate is tested by reading that
//! row instead of seeking the fact tables once per fact. The fact tables stay
//! the authority for set-based lookups by attribute and value.
//!
//! Layout: a version byte, then the exact, integer and sort sections. Each
//! section is a count followed by its facts in canonical order. A fact starts
//! with its attribute's length, or 0 when it repeats the previous fact's
//! attribute in the same section (tokens are never empty), then the attribute
//! bytes, then the value: a length and bytes for exact facts, a zigzag varint
//! for integer and sort facts.

use predicate_index::{ExactFact, ExactValue, FactSource, IndexDocument, IntegerFact, Token};

const VERSION: u8 = 1;

/// The blob for `document`'s facts, in canonical order whatever order the
/// document holds them in.
pub(super) fn encode(document: &IndexDocument) -> Vec<u8> {
    let mut exact = document.exact_facts.iter().collect::<Vec<_>>();
    exact.sort();
    let mut integer = document.integer_facts.iter().collect::<Vec<_>>();
    integer.sort();
    let mut sort = document.sort_facts.iter().collect::<Vec<_>>();
    sort.sort();
    let mut out = Vec::with_capacity(16 + 24 * (exact.len() + integer.len() + sort.len()));
    out.push(VERSION);
    put_varint(&mut out, exact.len() as u64);
    let mut previous: Option<&str> = None;
    for fact in exact {
        put_attribute(&mut out, &mut previous, fact.attribute.as_str());
        put_varint(&mut out, fact.value.as_bytes().len() as u64);
        out.extend_from_slice(fact.value.as_bytes());
    }
    for facts in [integer, sort] {
        put_varint(&mut out, facts.len() as u64);
        let mut previous: Option<&str> = None;
        for fact in facts {
            put_attribute(&mut out, &mut previous, fact.attribute.as_str());
            put_varint(&mut out, zigzag(fact.value));
        }
    }
    out
}

/// Facts borrowed from a blob.
#[derive(Debug, Default)]
pub(super) struct Facts<'a> {
    exact: Vec<(&'a str, &'a [u8])>,
    integer: Vec<(&'a str, i64)>,
    sort: Vec<(&'a str, i64)>,
}

/// The blob's facts, or `None` when it is not one [`encode`] wrote.
pub(super) fn decode(blob: &[u8]) -> Option<Facts<'_>> {
    let mut facts = Facts::default();
    decode_into(blob, &mut facts)?;
    Some(facts)
}

/// [`decode`] into `facts`, reusing its buffers.
pub(super) fn decode_into<'a>(blob: &'a [u8], facts: &mut Facts<'a>) -> Option<()> {
    facts.exact.clear();
    facts.integer.clear();
    facts.sort.clear();
    let mut reader = Reader { blob, at: 0 };
    if reader.byte()? != VERSION {
        return None;
    }
    let count = reader.count()?;
    let mut previous = None;
    for _ in 0..count {
        let attribute = reader.attribute(&mut previous)?;
        let length = reader.count()?;
        facts.exact.push((attribute, reader.bytes(length)?));
    }
    for target in [&mut facts.integer, &mut facts.sort] {
        let count = reader.count()?;
        let mut previous = None;
        for _ in 0..count {
            let attribute = reader.attribute(&mut previous)?;
            target.push((attribute, unzigzag(reader.varint()?)));
        }
    }
    (reader.at == blob.len()).then_some(())
}

impl Facts<'_> {
    /// The facts as an owned, canonical document.
    pub(super) fn into_document(
        &self,
        record_key: predicate_index::RecordKey,
        profile: predicate_index::Profile,
        partition: Token,
    ) -> Option<IndexDocument> {
        let token = |name: &str| Token::new(name).ok();
        let mut document = IndexDocument {
            record_key,
            profile,
            partition,
            exact_facts: self
                .exact
                .iter()
                .map(|(attribute, value)| {
                    Some(ExactFact {
                        attribute: token(attribute)?,
                        value: ExactValue::new(value.to_vec()).ok()?,
                    })
                })
                .collect::<Option<_>>()?,
            integer_facts: self
                .integer
                .iter()
                .map(|(attribute, value)| {
                    Some(IntegerFact {
                        attribute: token(attribute)?,
                        value: *value,
                    })
                })
                .collect::<Option<_>>()?,
            sort_facts: self
                .sort
                .iter()
                .map(|(attribute, value)| {
                    Some(IntegerFact {
                        attribute: token(attribute)?,
                        value: *value,
                    })
                })
                .collect::<Option<_>>()?,
        };
        document.canonicalize();
        Some(document)
    }
}

impl FactSource for Facts<'_> {
    fn exact_facts(&self) -> impl Iterator<Item = (&str, &[u8])> + '_ {
        self.exact.iter().copied()
    }

    fn integer_facts(&self) -> impl Iterator<Item = (&str, i64)> + '_ {
        self.integer.iter().copied()
    }

    fn sort_facts(&self) -> impl Iterator<Item = (&str, i64)> + '_ {
        self.sort.iter().copied()
    }
}

fn put_attribute<'a>(out: &mut Vec<u8>, previous: &mut Option<&'a str>, attribute: &'a str) {
    if *previous == Some(attribute) {
        out.push(0);
    } else {
        put_varint(out, attribute.len() as u64);
        out.extend_from_slice(attribute.as_bytes());
        *previous = Some(attribute);
    }
}

fn put_varint(out: &mut Vec<u8>, mut value: u64) {
    while value >= 0x80 {
        out.push((value as u8) | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

fn zigzag(value: i64) -> u64 {
    ((value << 1) ^ (value >> 63)) as u64
}

fn unzigzag(value: u64) -> i64 {
    ((value >> 1) as i64) ^ -((value & 1) as i64)
}

struct Reader<'a> {
    blob: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn byte(&mut self) -> Option<u8> {
        let byte = *self.blob.get(self.at)?;
        self.at += 1;
        Some(byte)
    }

    fn varint(&mut self) -> Option<u64> {
        let mut value = 0u64;
        for shift in (0..64).step_by(7) {
            let byte = self.byte()?;
            value |= u64::from(byte & 0x7f).checked_shl(shift)?;
            if byte & 0x80 == 0 {
                return Some(value);
            }
        }
        None
    }

    /// A length or count, bounded by the bytes left so a corrupt blob cannot
    /// ask for a huge allocation.
    fn count(&mut self) -> Option<usize> {
        let value = usize::try_from(self.varint()?).ok()?;
        (value <= self.blob.len() - self.at).then_some(value)
    }

    fn bytes(&mut self, length: usize) -> Option<&'a [u8]> {
        let bytes = self.blob.get(self.at..self.at.checked_add(length)?)?;
        self.at += length;
        Some(bytes)
    }

    fn attribute(&mut self, previous: &mut Option<&'a str>) -> Option<&'a str> {
        let length = self.count()?;
        if length == 0 {
            return *previous;
        }
        let attribute = std::str::from_utf8(self.bytes(length)?).ok()?;
        *previous = Some(attribute);
        Some(attribute)
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod test;
