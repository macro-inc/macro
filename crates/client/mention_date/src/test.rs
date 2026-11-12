//! The byte parser against the regex it replaces. `old` is the previous implementation verbatim
//! (Rust regex, where `\d` is any Unicode decimal digit); `ascii` is the same pattern with ASCII
//! digits, a Rust oracle for the pattern's JS `\d` reading. It is not a run of the TS twin
//! `parseDateMentionBody`, which also trims and labels years 0-99 through `Date.UTC` (a separate,
//! pre-existing difference).
use super::*;

fn label(captures: Option<(&str, &str, &str, &str, &str, &str)>) -> Option<String> {
    let (_, year, month, day, hour, minute) = captures?;
    let year: u32 = year.parse().ok()?;
    let month: usize = month.parse().ok()?;
    let day: u32 = day.parse().ok()?;
    let is_leap = (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400);
    let days_in_month = match month {
        2 if is_leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        1..=12 => 31,
        _ => return None,
    };
    if day == 0 || day > days_in_month {
        return None;
    }
    let date = format!("{} {day}, {year}", MONTHS[month - 1]);
    if hour.is_empty() {
        return Some(date);
    }
    let hour: u32 = hour.parse().ok()?;
    if hour > 23 || minute.parse::<u32>().ok()? > 59 {
        return None;
    }
    let period = if hour < 12 { "AM" } else { "PM" };
    let hour = match hour % 12 {
        0 => 12,
        hour => hour,
    };
    Some(format!("{date}, {hour}:{minute} {period}"))
}

fn old(body: &str) -> Option<String> {
    label(lazy_regex::regex_captures!(
        r"^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$",
        body
    ))
}

fn ascii(body: &str) -> Option<String> {
    label(lazy_regex::regex_captures!(
        r"^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:T([0-9]{2}):([0-9]{2})(?::[0-9]{2}(?:\.[0-9]+)?)?(?:Z|[+-][0-9]{2}:[0-9]{2}))?$",
        body
    ))
}

/// Decimal digits that are not ASCII: Rust regex `\d` accepts them, JS `\d` does not.
fn has_unicode_digit(body: &str) -> bool {
    body.chars().any(|ch| {
        !ch.is_ascii_digit() && lazy_regex::regex_is_match!(r"^\d$", ch.encode_utf8(&mut [0; 4]))
    })
}

fn corpus() -> Vec<String> {
    let years = [
        "0000",
        "0001",
        "1900",
        "2000",
        "2024",
        "2026",
        "9999",
        "999",
        "20261",
        "２０２６",
        "٢٠٢٦",
    ];
    let months = [
        "00", "01", "02", "04", "09", "11", "12", "13", "1", "001", "99", "٠١",
    ];
    let days = ["00", "01", "09", "28", "29", "30", "31", "32", "3", "٠٥"];
    let separators = ["-", "/", ""];
    let times = [
        "",
        "T00:00Z",
        "T00:30Z",
        "T11:59Z",
        "T12:00Z",
        "T23:59Z",
        "T24:00Z",
        "T12:60Z",
        "T1:00Z",
        "T12:0Z",
        "T12:00",
        "T12:00:30Z",
        "T12:00:30.5Z",
        "T12:00:30.123456+05:30",
        "T12:00.5Z",
        "T12:00:3Z",
        "T12:00+0530",
        "T12:00-05:00",
        "T12:00+05:3",
        "t12:00Z",
        "T12:00z",
        "T12:00:30.Z",
        "T12:00:30.٥Z",
        "T12:00+٠٥:٣٠",
        "T12:00:٣٠Z",
        "T١٢:00Z",
        "T12:٠٠Z",
        "T 12:00Z",
        "T12:00Z+01:00",
        "T12:00:30:00Z",
        "T12:00:30.5.5Z",
        " 12:00Z",
    ];
    let tails = ["", "\n", " ", "x", "Z"];
    let mut out = Vec::new();
    for year in years {
        for separator in separators {
            for month in months {
                for day in days {
                    for time in times {
                        for tail in tails {
                            out.push(format!(
                                "{year}{separator}{month}{separator}{day}{time}{tail}"
                            ));
                        }
                    }
                }
            }
        }
    }
    // Deterministic random strings over the pattern's alphabet, and single-edit mutations of valid
    // bodies, so near-misses at every position are compared too.
    let alphabet: Vec<char> = "0123456789-T:+.Zz \n٣２/".chars().collect();
    let mut seed: u64 = 0x2545_f491_4f6c_dd1d;
    let mut next = |bound: usize| {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        (seed % bound as u64) as usize
    };
    for _ in 0..200_000 {
        let length = next(32);
        out.push(
            (0..length)
                .map(|_| alphabet[next(alphabet.len())])
                .collect(),
        );
    }
    for valid in [
        "2026-11-13",
        "2024-02-29T23:59:59.999-12:00",
        "2026-01-01T00:00Z",
    ] {
        let chars: Vec<char> = valid.chars().collect();
        for index in 0..=chars.len() {
            for &ch in &alphabet {
                let mut replaced = chars.clone();
                if index < chars.len() {
                    replaced[index] = ch;
                    out.push(replaced.iter().collect());
                }
                let mut inserted = chars.clone();
                inserted.insert(index, ch);
                out.push(inserted.iter().collect());
            }
            if index < chars.len() {
                let mut deleted = chars.clone();
                deleted.remove(index);
                out.push(deleted.iter().collect());
            }
        }
    }
    out
}

#[test]
fn the_parser_matches_the_previous_regex_outside_unicode_digits() {
    let mut compared = 0;
    for body in corpus() {
        if has_unicode_digit(&body) {
            continue;
        }
        assert_eq!(bare_date_label(&body), old(&body), "{body:?}");
        compared += 1;
    }
    assert!(compared > 200_000, "compared {compared}");
}

#[test]
fn the_parser_matches_the_ascii_digit_pattern_everywhere() {
    for body in corpus() {
        assert_eq!(bare_date_label(&body), ascii(&body), "{body:?}");
    }
}

#[test]
fn unicode_digits_in_unparsed_fields_no_longer_label() {
    // Named fix: the previous Rust regex matched non-ASCII digits in the seconds, fraction and
    // offset fields, which are never parsed, so it labeled bodies the pattern's JS `\d` rejects.
    for body in [
        "2026-11-13T15:00+٠١:٠٠",
        "2026-11-13T15:00:٣٠Z",
        "2026-11-13T15:00:30.٥Z",
    ] {
        assert_eq!(old(body).as_deref(), Some("Nov 13, 2026, 3:00 PM"));
        assert_eq!(ascii(body), None);
        assert_eq!(bare_date_label(body), None, "{body:?}");
    }
}

#[test]
fn labels_as_written() {
    for (body, label) in [
        ("2026-11-13", Some("Nov 13, 2026")),
        ("2024-02-29", Some("Feb 29, 2024")),
        ("2023-02-29", None),
        ("2026-11-13T00:05Z", Some("Nov 13, 2026, 12:05 AM")),
        (
            "2026-11-13T12:00:30.25+05:30",
            Some("Nov 13, 2026, 12:00 PM"),
        ),
        ("2026-11-13T15:00", None),
    ] {
        assert_eq!(bare_date_label(body).as_deref(), label, "{body:?}");
    }
}
