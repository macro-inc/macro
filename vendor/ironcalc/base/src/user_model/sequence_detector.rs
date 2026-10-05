use std::collections::HashMap;

use crate::locale::Locale;
use crate::number_format::parse_finite_number;

enum DateCaseStyle {
    Uppercase,
    Capitalized,
    Lowercase,
}
impl DateCaseStyle {
    fn new(case_seed: &str) -> Self {
        let case_seed = case_seed.trim_matches(['.', ' ']);
        if case_seed.chars().all(|c| c.is_uppercase()) {
            Self::Uppercase
        } else if case_seed.chars().next().is_some_and(|c| c.is_uppercase()) {
            Self::Capitalized
        } else {
            Self::Lowercase
        }
    }

    fn apply(&self, dates: &[String]) -> Vec<String> {
        match self {
            DateCaseStyle::Uppercase => dates.iter().map(|date| date.to_uppercase()).collect(),
            DateCaseStyle::Capitalized => dates
                .iter()
                .map(|date| {
                    let mut chars = date.chars();
                    chars.next().unwrap_or_default().to_uppercase().to_string() + chars.as_str()
                })
                .collect(),
            DateCaseStyle::Lowercase => dates.iter().map(|date| date.to_lowercase()).collect(),
        }
    }
}
pub(crate) struct NumericProgression {
    last: f64,
    step: f64,
    decimal_sep: char,
}
impl NumericProgression {
    fn next(&self, i: usize) -> f64 {
        self.last + self.step * (i as f64 + 1.0)
    }
}

pub(crate) struct SuffixedProgression {
    numeric_progression: NumericProgression,
    prefix: String,
}
impl SuffixedProgression {
    fn next(&self, i: usize) -> String {
        format!(
            "{}{}",
            self.prefix,
            Progression::format_number(&self.numeric_progression, i)
        )
    }
}

pub(crate) struct DateProgression {
    numeric_progression: NumericProgression,
    dates: Vec<String>,
}

impl DateProgression {
    fn next(&self, i: usize) -> String {
        let num_next_index = self.numeric_progression.next(i);
        let months_len = self.dates.len() as f64;
        let next_index = (num_next_index % months_len + months_len) % months_len;
        self.dates[next_index as usize].clone()
    }
}

fn round_sig(value: f64) -> f64 {
    // rounding up to 15 significant figures
    if value == 0.0 {
        return 0.0;
    }
    let rounded = value.round();
    if (value - rounded).abs() <= 1e-14 * value.abs().max(1.0) {
        return rounded;
    }
    let sign = value.signum();
    let abs_value = value.abs();
    let exponent = abs_value.log10().floor();
    let normalized = abs_value / 10.0_f64.powf(exponent);
    let rounded_normalized = (normalized * 1e14).round() / 1e14;
    sign * rounded_normalized * 10.0_f64.powf(exponent)
}

pub(crate) enum Progression {
    Numeric(NumericProgression),
    SuffixedNumber(SuffixedProgression),
    Date(DateProgression),
}
impl Progression {
    fn format_number(progression: &NumericProgression, i: usize) -> String {
        round_sig(progression.next(i))
            .to_string()
            .replace('.', &progression.decimal_sep.to_string())
    }
    pub(crate) fn next(&self, i: usize) -> String {
        match self {
            Progression::Numeric(num_prog) => Self::format_number(num_prog, i),
            Progression::SuffixedNumber(suffnum_prog) => suffnum_prog.next(i),
            Progression::Date(date_prog) => date_prog.next(i),
        }
    }
}

trait SequenceDetector {
    fn detect(&self, values: &[String]) -> Option<Progression>;
}

struct NumericProgressionDetector<'a> {
    locale: &'a Locale,
}

impl<'a> NumericProgressionDetector<'a> {
    fn new(locale: &'a Locale) -> Self {
        Self { locale }
    }

    fn validate_group(part: &str, min_len: usize, max_len: usize) -> Result<(), ()> {
        let len = part.len();
        (!part.is_empty()
            && part.chars().all(|c| c.is_ascii_digit())
            && len >= min_len
            && len <= max_len)
            .then_some(())
            .ok_or(())
    }

    fn validate_grouping(&self, value: &str, primary: usize, secondary: usize) -> Result<(), ()> {
        let symbols = &self.locale.numbers.symbols;
        let decimal_sep = symbols.decimal.chars().next().unwrap_or('.');
        let group_sep = symbols.group.chars().next().unwrap_or(',');

        if value.chars().filter(|&c| c == decimal_sep).count() > 1 {
            return Err(());
        }

        let value_for_grouping = value.strip_prefix('-').unwrap_or(value);

        let (int_part, frac_part) = value_for_grouping
            .split_once(decimal_sep)
            .map_or((value_for_grouping, None), |(int, frac)| (int, Some(frac)));

        if let Some(frac) = frac_part {
            if !frac.chars().all(|c| c.is_ascii_digit()) {
                return Err(());
            }
        }

        let mut groups = int_part.split(group_sep).peekable();

        if !int_part.contains(group_sep) {
            let group = groups.next().ok_or(())?;
            Self::validate_group(group, 1, usize::MAX)?;
        }

        // first
        if let Some(group) = groups.next() {
            Self::validate_group(group, 1, secondary)?;
        }

        while let Some(group) = groups.next() {
            let len = if groups.peek().is_some() {
                // middle
                secondary
            } else {
                // last
                primary
            };
            Self::validate_group(group, len, len)?;
        }

        Ok(())
    }
}

impl SequenceDetector for NumericProgressionDetector<'_> {
    fn detect(&self, values: &[String]) -> Option<Progression> {
        let numbers = &self.locale.numbers;

        let decimal_sep = numbers.symbols.decimal.chars().next().unwrap_or('.');
        let group_sep = numbers.symbols.group.chars().next().unwrap_or(',');
        let decimal_format = &numbers.decimal_formats.standard;

        let groups_len = decimal_format
            .split_once('.')
            .map_or(decimal_format.as_str(), |(int, _)| int)
            .split(',')
            .map(|group| group.len())
            .collect::<Vec<_>>();

        let primary = groups_len.last().unwrap_or(&3);
        let secondary = if groups_len.len() > 2 {
            groups_len
                .get(groups_len.len().saturating_sub(2)) // penultimate
                .unwrap_or(&3)
        } else {
            primary
        };

        values
            .iter()
            .map(|num| {
                self.validate_grouping(num, *primary, *secondary)?;

                let number = num
                    .chars()
                    .filter(|&c| c != group_sep)
                    .map(|c| if c == decimal_sep { '.' } else { c })
                    .collect::<String>();
                parse_finite_number(&number).ok_or(())
            })
            .collect::<Result<Vec<_>, _>>()
            .ok()
            .filter(|nums| nums.len() >= 2)
            .and_then(|mut nums| {
                nums = nums.iter().map(|num| round_sig(*num)).collect();

                let step = nums[1] - nums[0];
                if step.abs() < 1e-14 {
                    return None;
                }

                let is_progression = nums.windows(2).all(|w| (w[1] - w[0] - step).abs() < 1e-6);
                if !is_progression {
                    return None;
                }

                let last = nums[nums.len() - 1];

                Some(Progression::Numeric(NumericProgression {
                    last,
                    step,
                    decimal_sep,
                }))
            })
    }
}

struct SuffixedNumberDetector<'a> {
    locale: &'a Locale,
}

impl SuffixedNumberDetector<'_> {
    fn suffix_index(value: &str) -> usize {
        let digits = value
            .chars()
            .rev()
            .take_while(|c| c.is_ascii_digit())
            .count();
        if digits == value.len() {
            0
        } else {
            digits
        }
    }
}

impl SequenceDetector for SuffixedNumberDetector<'_> {
    fn detect(&self, values: &[String]) -> Option<Progression> {
        if values.len() < 2 {
            return None;
        }
        let value0 = &values[0];

        let suffix_indexes: Vec<_> = values.iter().map(|v| Self::suffix_index(v)).collect();

        let all_have_suffixes = suffix_indexes.iter().all(|i| *i != 0);
        if !all_have_suffixes {
            return None;
        }

        let (prefixes, suffixes): (Vec<_>, Vec<_>) = values
            .iter()
            .zip(suffix_indexes.iter())
            .map(|(value, &suffix_len)| {
                let suffix_start = value.len() - suffix_len;
                (
                    value[..suffix_start].to_string(), // prefix
                    value[suffix_start..].to_string(), // suffix
                )
            })
            .unzip();

        let prefix0 = &value0[..value0.len() - suffix_indexes[0]];

        let all_have_same_prefix = prefixes.iter().all(|prefix| prefix.eq(prefix0));
        if !all_have_same_prefix {
            return None;
        }

        let Progression::Numeric(numeric_progression_from_suffixes) =
            NumericProgressionDetector::new(self.locale).detect(&suffixes)?
        else {
            return None;
        };

        Some(Progression::SuffixedNumber(SuffixedProgression {
            numeric_progression: numeric_progression_from_suffixes,
            prefix: prefix0.to_string(),
        }))
    }
}

struct DateProgressionDetector<'a> {
    locale: &'a Locale,
    case_style: DateCaseStyle,
}

impl<'a> DateProgressionDetector<'a> {
    fn normalize(s: &str) -> String {
        let s = s.trim_matches(['.', ' ']);
        let mut result = String::with_capacity(s.len());
        for c in s.chars() {
            for lc in c.to_lowercase() {
                match lc {
                    'á' | 'ä' => result.push('a'),
                    'é' => result.push('e'),
                    'ì' => result.push('i'),
                    'û' => result.push('u'),
                    _ => result.push(lc),
                }
            }
        }
        result
    }
    fn find_progression(&self, values: &[String], dates: &[String]) -> Option<Progression> {
        let date_indexes = dates
            .iter()
            .enumerate()
            .map(|(idx, date)| (Self::normalize(date), idx))
            .collect::<HashMap<_, _>>();

        let indexes = values
            .iter()
            .map(|value| date_indexes.get(value).map(|&idx| idx.to_string()))
            .collect::<Option<Vec<_>>>()?;

        let Progression::Numeric(numeric_progression) =
            NumericProgressionDetector::new(self.locale).detect(&indexes)?
        else {
            return None;
        };

        Some(Progression::Date(DateProgression {
            numeric_progression,
            dates: self.case_style.apply(dates),
        }))
    }
}

impl<'a> SequenceDetector for DateProgressionDetector<'a> {
    fn detect(&self, values: &[String]) -> Option<Progression> {
        if values.len() < 2 {
            return None;
        }
        let normalized_values = values
            .iter()
            .map(|value| Self::normalize(value))
            .collect::<Vec<_>>();

        let dates = &self.locale.dates;

        [
            &dates.day_names,
            &dates.day_names_short,
            &dates.months,
            &dates.months_short,
        ]
        .iter()
        .find_map(|&names_vec| self.find_progression(&normalized_values, names_vec))
    }
}

pub(crate) fn detect_progression(
    values: &[String],
    locale: &Locale,
    case_seed: &str,
) -> Option<Progression> {
    if let Some(progression) = NumericProgressionDetector::new(locale).detect(values) {
        return Some(progression);
    }
    if let Some(progression) = (SuffixedNumberDetector { locale }).detect(values) {
        return Some(progression);
    }

    let case_style = DateCaseStyle::new(case_seed);
    if let Some(progression) = (DateProgressionDetector { locale, case_style }).detect(values) {
        return Some(progression);
    }
    None
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use crate::locale::get_locale;

    use super::*;

    #[test]
    fn test_numeric_progression_detector() {
        let locale = get_locale("en").unwrap();
        let detector = NumericProgressionDetector::new(locale);

        let values = vec!["1".to_string(), "2".to_string(), "3".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "4");
        assert_eq!(progression.next(1), "5");

        let values = vec!["10".to_string(), "8".to_string(), "6".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "4");
        assert_eq!(progression.next(1), "2");

        let values = vec!["-10".to_string(), "-8".to_string(), "-6".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "-4");
        assert_eq!(progression.next(1), "-2");

        let values = vec!["1".to_string()];
        assert!(detector.detect(&values).is_none());

        let values = vec!["1".to_string(), "3".to_string(), "4".to_string()];
        assert!(detector.detect(&values).is_none());
    }

    #[test]
    fn test_numeric_float() {
        let locale = get_locale("en").unwrap();
        let detector = NumericProgressionDetector::new(locale);

        let values = vec!["1.5".to_string(), "2.0".to_string(), "2.5".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "3");
        assert_eq!(progression.next(1), "3.5");

        let values = vec!["0.1".to_string(), "0.2".to_string(), "0.3".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "0.4");

        let values = vec![
            "0.001".to_string(),
            "0.002".to_string(),
            "0.003".to_string(),
        ];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "0.004");

        let values = vec!["-1.5".to_string(), "-1.0".to_string(), "-0.5".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "0");
        assert_eq!(progression.next(1), "0.5");

        let values = vec!["10.5".to_string(), "9.5".to_string(), "8.5".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "7.5");

        let values = vec![
            "10000.4000000007".to_string(),
            "10000.4000000008".to_string(),
            "10000.4000000009".to_string(),
        ];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "10000.400000001");

        let values = vec![
            "10000.40000000007".to_string(),
            "10000.40000000008".to_string(),
            "10000.40000000009".to_string(),
        ];
        assert!(detector.detect(&values).is_none());

        let values = vec!["0.3".to_string(), "0.6".to_string(), "0.9".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "1.2");
    }

    #[test]
    fn test_numeric_grouping_validation() {
        let locale = get_locale("en").unwrap();
        let detector = NumericProgressionDetector::new(locale);

        let values = vec!["1000000".to_string(), "2000000".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "3000000");

        let values = vec!["1000.50".to_string(), "2000.50".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "3000.5");

        let values = vec!["1,000".to_string(), "2,000".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "3000");

        let values = vec!["1,000,000".to_string(), "2,000,000".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "3000000");

        let values = vec!["-100,000.5".to_string(), "-100,001.5".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "-100002.5");

        let values = vec!["1,0000,000".to_string(), "2,0000,000".to_string()];
        assert!(detector.detect(&values).is_none());

        let values = vec!["1,00,00,00".to_string(), "2,00,00,00".to_string()];
        assert!(detector.detect(&values).is_none());

        let values = vec!["100.5.2".to_string(), "200.5.2".to_string()];
        assert!(detector.detect(&values).is_none());

        let values = vec!["1,,000".to_string(), "2,,000".to_string()];
        assert!(detector.detect(&values).is_none());

        let values = vec![",1000".to_string(), ",2000".to_string()];
        assert!(detector.detect(&values).is_none());

        let values = vec!["1000.5,00".to_string(), "2000.5,00".to_string()];
        assert!(detector.detect(&values).is_none());
    }

    #[test]
    fn test_numeric_progression_detector_locale_de() {
        let locale = get_locale("de").unwrap();
        let detector = NumericProgressionDetector::new(locale);

        let values = vec!["1,5".to_string(), "2,0".to_string(), "2,5".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "3");
        assert_eq!(progression.next(1), "3,5");

        let values = vec![
            "1.000".to_string(),
            "2.000".to_string(),
            "3.000".to_string(),
        ];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "4000");
        assert_eq!(progression.next(1), "5000");

        let values = vec!["1.000,5".to_string(), "2.000,5".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "3000,5");

        let values = vec!["1,7".to_string(), "1,8".to_string(), "1,9".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "2");
        assert_eq!(progression.next(1), "2,1");
    }

    #[test]
    fn test_suffixed_progression_detector() {
        let locale = get_locale("en").unwrap();
        let detector = SuffixedNumberDetector { locale };

        let values = vec!["A1".to_string(), "A2".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "A3");
        assert_eq!(progression.next(1), "A4");

        let values = vec!["A0.1".to_string(), "A0.2".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "A0.3");
        assert_eq!(progression.next(1), "A0.4");
        assert_eq!(progression.next(2), "A0.5");
        assert_eq!(progression.next(3), "A0.6");
        assert_eq!(progression.next(4), "A0.7");
        assert_eq!(progression.next(5), "A0.8");
        assert_eq!(progression.next(6), "A0.9");
        assert_eq!(progression.next(7), "A0.10");

        let values = vec!["Product 1".to_string(), "Product 2".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "Product 3");

        let values = vec!["Q10".to_string(), "Q9".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "Q8");

        let values = vec!["A1".to_string(), "B2".to_string()];
        assert!(detector.detect(&values).is_none());

        let values = vec!["Test-A".to_string(), "Test-B".to_string()];
        assert!(detector.detect(&values).is_none());

        let values = vec!["Test".to_string(), "Test".to_string()];
        assert!(detector.detect(&values).is_none());
    }

    #[test]
    fn test_suffixed_progression_float_like_suffix() {
        let locale = get_locale("en").unwrap();
        let detector = SuffixedNumberDetector { locale };

        let values = vec!["V1.0".to_string(), "V1.5".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "V1.10");
    }

    #[test]
    fn test_date_progression_detector_en() {
        let locale = get_locale("en").unwrap();
        let case_style = DateCaseStyle::new("Monday");
        let detector = DateProgressionDetector { locale, case_style };

        let values = vec!["Monday".to_string(), "Tuesday".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "Wednesday");

        let values = vec!["Mon".to_string(), "Tue".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "Wed");

        let values = vec!["January".to_string(), "February".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "March");

        let values = vec!["Jan".to_string(), "Feb".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "Mar");

        let values = vec!["Jan.".to_string(), "Feb.".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "Mar");

        let values = vec!["Jan ".to_string(), "Feb ".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "Mar");

        let values = vec!["Saturday".to_string(), "Sunday".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "Monday");

        let values = vec!["Jan".to_string(), "Mar".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "May");

        let values = vec!["Jan".to_string(), "Feb".to_string(), "Apr".to_string()];
        assert!(detector.detect(&values).is_none());

        let case_style = DateCaseStyle::new("jan");
        let detector = DateProgressionDetector { locale, case_style };

        let values = vec!["jan".to_string(), "feb".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "mar");

        let values = vec!["saturday".to_string(), "SUNDAY".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "monday");

        let values = vec!["monday".to_string(), "tuesday".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "wednesday");

        let values = vec!["january".to_string(), "february".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "march");

        let case_style = DateCaseStyle::new("MONDAY");
        let detector = DateProgressionDetector { locale, case_style };

        let values = vec!["MONDAY".to_string(), "TUESDAY".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "WEDNESDAY");

        let values = vec!["JANUARY".to_string(), "FEBRUARY".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "MARCH");

        let values = vec!["JAN".to_string(), "FEB".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "MAR");

        let case_style = DateCaseStyle::new(" MONDAY ");
        let detector = DateProgressionDetector { locale, case_style };

        let values = vec!["JAN. ".to_string(), "FEB. ".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "MAR");
    }

    #[test]
    fn test_date_progression_detector_fr() {
        let locale = get_locale("fr").unwrap();
        let case_style = DateCaseStyle::new("lundi");
        let detector = DateProgressionDetector { locale, case_style };

        let values = vec!["lundi".to_string(), "mardi".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "mercredi");

        let values = vec!["janvier".to_string(), "février".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "mars");

        let values = vec!["janvier".to_string(), "fevrier".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "mars");

        let values = vec!["janv.".to_string(), "févr.".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "mars");

        let case_style = DateCaseStyle::new("LUNDI");
        let detector = DateProgressionDetector { locale, case_style };

        let values = vec!["LUNDI".to_string(), "MARDI".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "MERCREDI");

        let values = vec!["JANVIER".to_string(), "FÉVRIER".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "MARS");

        let case_style = DateCaseStyle::new("Lundi");
        let detector = DateProgressionDetector { locale, case_style };

        let values = vec!["Lundi".to_string(), "Mardi".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "Mercredi");
    }

    #[test]
    fn test_date_progression_detector_de() {
        let locale = get_locale("de").unwrap();

        let case_style = DateCaseStyle::new("Jan");
        let detector = DateProgressionDetector { locale, case_style };

        let values = vec!["Jan".to_string(), "Feb".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "Mär");

        let values = vec!["So.".to_string(), "Mo.".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "Di");
    }

    #[test]
    fn test_date_progression_detector_es() {
        let locale = get_locale("es").unwrap();
        let case_style = DateCaseStyle::new("lunes");
        let detector = DateProgressionDetector { locale, case_style };

        let values = vec!["lunes".to_string(), "martes".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "miércoles");

        let values = vec!["enero".to_string(), "febrero".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "marzo");

        let case_style = DateCaseStyle::new("LUNES");
        let detector = DateProgressionDetector { locale, case_style };

        let values = vec!["LUNES".to_string(), "MARTES".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "MIÉRCOLES");

        let values = vec!["ENERO".to_string(), "FEBRERO".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "MARZO");

        let case_style = DateCaseStyle::new("Lunes");
        let detector = DateProgressionDetector { locale, case_style };

        let values = vec!["Lunes".to_string(), "Martes".to_string()];
        let progression = detector.detect(&values).unwrap();
        assert_eq!(progression.next(0), "Miércoles");
    }

    #[test]
    fn test_detect_progression() {
        let locale = get_locale("en").unwrap();
        let case_seed = "Mar";

        let values = vec!["1".to_string(), "3".to_string()];
        let p = detect_progression(&values, locale, case_seed).unwrap();
        assert_eq!(p.next(0), "5");

        let values = vec!["X10".to_string(), "X20".to_string()];
        let p = detect_progression(&values, locale, case_seed).unwrap();
        assert_eq!(p.next(0), "X30");

        let values = vec!["Mar".to_string(), "Apr".to_string()];
        let p = detect_progression(&values, locale, case_seed).unwrap();
        assert_eq!(p.next(0), "May");

        let values = vec!["1".to_string(), "A".to_string(), "foo".to_string()];
        assert!(detect_progression(&values, locale, case_seed).is_none());

        let values = vec!["1".to_string(), "2".to_string()];
        let p = detect_progression(&values, locale, case_seed).unwrap();
        assert!(matches!(p, Progression::Numeric(_)));
        assert_eq!(p.next(0), "3");
    }
}
