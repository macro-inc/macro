#![allow(clippy::uninlined_format_args)]

#[track_caller]
fn test_1_error(pattern: &str, expected_err: &str) {
    let res = regress::Regex::with_flags(pattern, "u");
    assert!(res.is_err(), "Pattern should not have parsed: {}", pattern);

    let err = res.err().unwrap().text;
    assert!(
        err.contains(expected_err),
        "Error text '{}' did not contain '{}' for pattern '{}'",
        err,
        expected_err,
        pattern
    );
}

#[test]
fn test_excessive_capture_groups() {
    let mut captures = String::from("s");
    let mut loops = String::from("s");
    for _ in 0..65536 {
        captures.push_str("(x)");
        loops.push_str("x{3,5}");
    }
    test_1_error(captures.as_str(), "Capture group count limit exceeded");
    test_1_error(loops.as_str(), "Loop count limit exceeded");
}

#[test]
fn test_excessive_nesting() {
    // Deeply nested constructs must be rejected with an error rather than
    // overflowing the parser's stack. See the MAX_NESTING_DEPTH limit.
    let deep = 5000;

    // Non-capturing groups: increment no other counter, so this is the purest
    // unbounded-recursion vector.
    let noncap = format!("{}a{}", "(?:".repeat(deep), ")".repeat(deep));
    test_1_error(&noncap, "too deeply nested");

    // Capturing groups.
    let cap = format!("{}a{}", "(".repeat(deep), ")".repeat(deep));
    test_1_error(&cap, "too deeply nested");

    // Nested `v`-mode class-set expressions recurse on their own path.
    let vclass = format!("{}a{}", "[".repeat(deep), "]".repeat(deep));
    let res = regress::Regex::with_flags(&vclass, "v");
    assert!(res.is_err(), "Deeply nested v-mode class should not parse");
    assert!(
        res.err().unwrap().text.contains("too deeply nested"),
        "Expected nesting error for deeply nested v-mode class"
    );

    // A pattern nested well within the limit must still compile.
    let shallow = 200;
    let ok = format!("{}a{}", "(?:".repeat(shallow), ")".repeat(shallow));
    assert!(
        regress::Regex::with_flags(&ok, "u").is_ok(),
        "Pattern nested within the limit should compile"
    );
}

#[test]
fn test_syntax_errors() {
    test_1_error(r"*", "Invalid atom character");
    test_1_error(r"x**", "Invalid atom character");
    test_1_error(r"?", "Invalid atom character");
    test_1_error(r"{3,5}", "Invalid atom character");
    test_1_error(r"x{5,3}", "Invalid quantifier");

    test_1_error(r"]", "Invalid atom character");
    test_1_error(r"[abc", "Unbalanced bracket");

    test_1_error(r"(", "Unbalanced parenthesis");
    test_1_error(r"(?!", "Unbalanced parenthesis");
    test_1_error(r"abc)", "Unbalanced parenthesis");

    test_1_error(
        r"[z-a]",
        "Range values reversed, start char code is greater than end char code.",
    );

    // In unicode mode this is not allowed.
    test_1_error(r"[a-\s]", "Invalid character range");

    test_1_error("\\", "Incomplete escape");

    test_1_error("^*", "Quantifier not allowed here");
    test_1_error("${3}", "Quantifier not allowed here");
    test_1_error("(?=abc)*", "Quantifier not allowed here");
    test_1_error("(?!abc){3,}", "Quantifier not allowed here");

    test_1_error(r"\2(a)", "Invalid character escape");
    test_1_error("(?q:abc)", "Invalid group modifier");
}

#[test]
fn test_invalid_hex_escape() {
    // Regression test for #134
    // In non-unicode mode, `\x` not followed by two hex digits is an identity
    // escape for `x` alone.
    let res = regress::Regex::with_flags(r"\1\x(", "");
    assert!(res.is_err());
    assert!(
        res.err().unwrap().text.contains("Unbalanced parenthesis"),
        "Expected the leftover '(' to be treated as an unterminated group"
    );

    // The hex digits are only consumed when they actually parse as hex.
    let re = regress::Regex::with_flags(r"\x41", "").unwrap();
    assert!(re.find("A").is_some());

    // With just one valid hex digit, only `x` is the identity escape; the
    // stray digit remains as a literal character.
    let re = regress::Regex::with_flags(r"\xg1", "").unwrap();
    assert!(re.find("xg1").is_some());
}
