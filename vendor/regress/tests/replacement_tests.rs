use regress::Regex;

#[test]
fn test_replace_basic() {
    let re = Regex::new(r"world").unwrap();
    let result = re.replace("hello world", "universe");
    assert_eq!(result, "hello universe");
}

#[test]
fn test_replace_no_match() {
    let re = Regex::new(r"xyz").unwrap();
    let result = re.replace("hello world", "universe");
    assert_eq!(result, "hello world");
}

#[test]
fn test_replace_with_capture_groups() {
    let re = Regex::new(r"(\w+)\s+(\w+)").unwrap();
    let result = re.replace("hello world", "$2 $1");
    assert_eq!(result, "world hello");
}

#[test]
fn test_replace_with_group_zero() {
    let re = Regex::new(r"\d+").unwrap();
    let result = re.replace("Price: $123", "[$0]");
    assert_eq!(result, "Price: $[123]");
}

#[test]
fn test_replace_with_literal_dollar() {
    let re = Regex::new(r"\d+").unwrap();
    let result = re.replace("Price: 123", "$$0");
    assert_eq!(result, "Price: $0");
}

#[test]
fn test_replace_date_format() {
    let re = Regex::new(r"(\d{4})-(\d{2})-(\d{2})").unwrap();
    let result = re.replace("2023-12-25", "$2/$3/$1");
    assert_eq!(result, "12/25/2023");
}

#[test]
fn test_replace_all_basic() {
    let re = Regex::new(r"\d+").unwrap();
    let result = re.replace_all("a1b2c3", "X");
    assert_eq!(result, "aXbXcX");
}

#[test]
fn test_replace_all_with_groups() {
    let re = Regex::new(r"(\w+)\s+(\w+)").unwrap();
    let result = re.replace_all("hello world foo bar", "$2-$1");
    assert_eq!(result, "world-hello bar-foo");
}

#[test]
fn test_replace_all_word_boundaries() {
    let re = Regex::new(r"\b(\w)(\w+)").unwrap();
    let result = re.replace_all("hello world", "$1.$2");
    assert_eq!(result, "h.ello w.orld");
}

#[test]
fn test_replace_with_closure() {
    let re = Regex::new(r"\d+").unwrap();
    let text = "Price: $123";
    let result = re.replace_with(text, |m| {
        let num: i32 = m.as_str(text).parse().unwrap();
        format!("{}", num * 2)
    });
    assert_eq!(result, "Price: $246");
}

#[test]
fn test_replace_all_with_closure() {
    let re = Regex::new(r"\d+").unwrap();
    let text = "Items: 5, 10, 15";
    let result = re.replace_all_with(text, |m| {
        let num: i32 = m.as_str(text).parse().unwrap();
        format!("[{}]", num * 10)
    });
    assert_eq!(result, "Items: [50], [100], [150]");
}

#[test]
fn test_replace_named_groups() {
    let re = Regex::new(r"(?<first>\w+)\s+(?<second>\w+)").unwrap();
    let result = re.replace("hello world", "${second} ${first}");
    assert_eq!(result, "world hello");
}

#[test]
fn test_replace_named_groups_malformed() {
    let re = Regex::new(r"(?<first>\w+)").unwrap();
    let result = re.replace("hello", "${first");
    assert_eq!(result, "${first");
}

#[test]
fn test_replace_nonexistent_group() {
    let re = Regex::new(r"(\w+)").unwrap();
    let result = re.replace("hello", "$1 $2 $3");
    assert_eq!(result, "hello  ");
}

#[test]
fn test_replace_high_group_numbers() {
    let re = Regex::new(r"(\w)(\w)(\w)").unwrap();
    let result = re.replace("abc", "$3$2$1$0");
    assert_eq!(result, "cbaabc");
}

#[test]
fn test_replace_large_group_number() {
    let re = Regex::new(r"(\w+)").unwrap();
    let result = re.replace("hello", "$999");
    assert_eq!(result, "");
}

#[test]
fn test_replace_dollar_at_end() {
    let re = Regex::new(r"\w+").unwrap();
    let result = re.replace("hello", "test$");
    assert_eq!(result, "test$");
}

#[test]
fn test_replace_email() {
    let re = Regex::new(r"(\w+)@(\w+)\.(\w+)").unwrap();
    let result = re.replace("Contact: user@example.com", "$1 at $2 dot $3");
    assert_eq!(result, "Contact: user at example dot com");
}

#[test]
fn test_replace_backreferences() {
    let re = Regex::new(r"(\w+)\s+\1").unwrap();
    let result = re.replace("hello hello world", "[$1]");
    assert_eq!(result, "[hello] world");
}

#[test]
fn test_replace_case_insensitive() {
    let re = Regex::with_flags(r"(\w+)", "i").unwrap();
    let result = re.replace("Hello WORLD", "[$1]");
    assert_eq!(result, "[Hello] WORLD");
}

#[test]
fn test_as_str_method() {
    let re = Regex::new(r"\d+").unwrap();
    let text = "Price: $123 and $456";
    let m = re.find(text).unwrap();
    assert_eq!(m.as_str(text), "123");
}

#[test]
fn test_replace_empty_match() {
    let re = Regex::new(r"(?=\d)").unwrap(); // Zero-width lookahead
    let result = re.replace("a1b2c", "X");
    assert_eq!(result, "aX1b2c");
}

#[test]
fn test_complex_replacement() {
    let re = Regex::new(r"(\d{1,2})/(\d{1,2})/(\d{4})").unwrap();
    let result = re.replace_all("Born on 12/25/1990 and graduated on 5/15/2012", "$3-$1-$2");
    assert_eq!(result, "Born on 1990-12-25 and graduated on 2012-5-15");
}
