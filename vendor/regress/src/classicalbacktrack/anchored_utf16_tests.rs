//! Engine-private controls over the same compiled regex and the legacy search.
use super::*;
use crate::api::Flags;
use crate::exec::MatchProducer;
use crate::indexing::{Ucs2Input, Utf16Input};
use std::cell::Cell;

thread_local! {
    static ATTEMPTS: Cell<Option<usize>> = const { Cell::new(None) };
}

pub(super) fn record_attempt() {
    ATTEMPTS.with(|count| {
        if let Some(value) = count.get() {
            count.set(Some(value + 1));
        }
    });
}

struct CountAttempts(Option<usize>);

impl CountAttempts {
    fn start() -> Self {
        Self(ATTEMPTS.with(|count| count.replace(Some(0))))
    }

    fn value(&self) -> usize {
        ATTEMPTS.with(|count| count.get().expect("attempt counter is active"))
    }
}

impl Drop for CountAttempts {
    fn drop(&mut self) {
        ATTEMPTS.with(|count| count.set(self.0));
    }
}

#[derive(Debug)]
struct Legacy<'r, Input: InputIndexer>(BacktrackExecutor<'r, Input>);

impl<Input: InputIndexer> MatchProducer for Legacy<'_, Input> {
    type Position = Input::Position;

    fn initial_position(&self, offset: usize) -> Option<Self::Position> {
        self.0.initial_position(offset)
    }

    fn next_match(
        &mut self,
        pos: Self::Position,
        next_start: &mut Option<Self::Position>,
    ) -> Option<Match> {
        self.0
            .next_match_with_prefix_search(pos, next_start, &bytesearch::EmptyString {})
    }
}

fn compile(source: &str, flags: &str) -> CompiledRegex {
    let flags = Flags::new(flags.chars().map(u32::from));
    let mut ir = crate::parse::try_parse(source.chars().map(u32::from), flags)
        .expect("literal test regex compiles");
    crate::optimizer::optimize(&mut ir);
    crate::emit::emit(&ir)
}

fn executor<Input: InputIndexer>(
    regex: &CompiledRegex,
    input: Input,
) -> BacktrackExecutor<'_, Input> {
    BacktrackExecutor::new(input, MatchAttempter::new(regex, input.left_end()))
}

type FullMatch = (Range<usize>, Vec<Option<Range<usize>>>, Box<[Box<str>]>);

fn full(matches: impl Iterator<Item = Match>) -> Vec<FullMatch> {
    matches
        .map(|m| (m.range, m.captures, m.group_names))
        .collect()
}

fn compare<Input: InputIndexer>(regex: &CompiledRegex, input: Input, start: usize) {
    let actual = full(exec::Matches::new(executor(regex, input), start));
    let legacy = full(exec::Matches::new(Legacy(executor(regex, input)), start));
    assert_eq!(actual, legacy, "start offset {start}; input {input:?}");
}

#[test]
fn anchored_plain_text_attempts_are_constant() {
    let regex = compile(r"^<m-placeholder>", "");
    assert!(matches!(
        regex.start_pred,
        crate::insn::StartPredicate::StartAnchored
    ));
    for length in [10_000, 97, 1, 0] {
        let units = vec![u16::from(b'a'); length];
        for unicode in [false, true] {
            let count = CountAttempts::start();
            if unicode {
                assert!(
                    exec::Matches::new(executor(&regex, Utf16Input::new(&units, false)), 0,)
                        .next()
                        .is_none()
                );
            } else {
                assert!(
                    exec::Matches::new(executor(&regex, Ucs2Input::new(&units, false)), 0,)
                        .next()
                        .is_none()
                );
            }
            assert_eq!(count.value(), 1, "encoding {unicode}; length {length}");
            drop(count);
            let count = CountAttempts::start();
            assert!(
                exec::Matches::new(Legacy(executor(&regex, Ucs2Input::new(&units, false))), 0,)
                    .next()
                    .is_none()
            );
            assert_eq!(count.value(), length + 1);
        }
    }
}

#[test]
fn unanchored_and_multiline_search_keep_the_legacy_attempts() {
    let units = vec![u16::from(b'a'); 97];
    for (source, flags) in [("zzz", ""), ("^zzz", "m"), ("^zzz|yyy", "")] {
        let regex = compile(source, flags);
        assert!(!matches!(
            regex.start_pred,
            crate::insn::StartPredicate::StartAnchored
        ));
        let input = Ucs2Input::new(&units, regex.flags.unicode);
        let count = CountAttempts::start();
        let actual = full(exec::Matches::new(executor(&regex, input), 0));
        assert_eq!(count.value(), units.len() + 1);
        drop(count);
        let count = CountAttempts::start();
        let legacy = full(exec::Matches::new(Legacy(executor(&regex, input)), 0));
        assert_eq!(count.value(), units.len() + 1);
        assert_eq!(actual, legacy);
    }
}

#[test]
fn same_compiled_regex_preserves_all_ranges_captures_and_offsets() {
    let patterns = [
        "^",
        "^$",
        "^(a*)",
        "^(a)?(b*)",
        "^(?<head>a*)(?<tail>b*)",
        "^a|^b",
        "(^a)|(^b)",
        "^a|b",
        "(?:^a)?b",
        "^|a",
        "a^b",
        "^(?=a)(a*)",
        "^(?!a)(.*)",
        "^(?<=a)b",
        "^(a*)\\1",
        "^(?:a|b)*",
        "^.*$",
        "^[^]*",
        "^\\w+",
        "^\\s*#",
        "^\\uD800",
        "^\\uDC00",
        "^\\u212a",
        "^\\u017f",
        "^(.)",
        "^([\\s\\S]*?)(a)?$",
        "^[a-z]+",
        "[^]",
        "a*",
    ];
    let flags = ["", "i", "u", "iu", "m", "im", "mu", "s", "ms", "v", "iv"];
    let mut inputs: Vec<Vec<u16>> = [
        "",
        "a",
        "b",
        "ababa",
        "aaabbb",
        "a\nb",
        "\r\na\r\n",
        "\u{2028}a\u{2029}",
        "ΣσςſK",
        "𐐀a𐐨",
        "😀ab",
        " abc # tail",
    ]
    .map(|s| s.encode_utf16().collect())
    .to_vec();
    inputs.extend([
        vec![0xd800],
        vec![0xdc00],
        vec![0xd800, 0x61, 0xdc00],
        vec![0xd800, 0xdc00, 0x61, 0xd800, 0xd800, 0xdc00],
    ]);
    let alphabet = [0x61, 0x62, 0x0a, 0x20, 0xd800, 0xdc00, 0x2028, 0x212a];
    let mut state = 0x4ab8_9e31_u32;
    for length in 0..25 {
        for _ in 0..5 {
            inputs.push(
                (0..length)
                    .map(|_| {
                        state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                        alphabet[((state >> 16) as usize) % alphabet.len()]
                    })
                    .collect(),
            );
        }
    }
    for pattern in patterns {
        for flags in flags {
            let regex = compile(pattern, flags);
            for units in &inputs {
                for start in 0..=units.len() + 1 {
                    compare(&regex, Ucs2Input::new(units, regex.flags.unicode), start);
                    compare(&regex, Utf16Input::new(units, regex.flags.unicode), start);
                }
            }
            for text in ["", "aaab", "x\na", "ΣKſ", "😀ab𐐀"] {
                let starts = text
                    .char_indices()
                    .map(|(i, _)| i)
                    .chain([text.len(), text.len() + 1]);
                for start in starts {
                    compare(&regex, Utf8Input::new(text, regex.flags.unicode), start);
                    if text.is_ascii() {
                        compare(&regex, AsciiInput::new(text, regex.flags.unicode), start);
                    }
                }
            }
        }
    }
}

#[test]
fn attempt_counter_restores_after_nested_scope_and_panic() {
    assert_eq!(ATTEMPTS.with(Cell::get), None);
    let outer = CountAttempts::start();
    record_attempt();
    let result = std::panic::catch_unwind(|| {
        let _inner = CountAttempts::start();
        record_attempt();
        panic!("test-only scope unwind");
    });
    assert!(result.is_err());
    assert_eq!(outer.value(), 1);
    drop(outer);
    assert_eq!(ATTEMPTS.with(Cell::get), None);
}
