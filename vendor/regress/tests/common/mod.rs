#![allow(clippy::uninlined_format_args)]

/// Test that \p pattern fails to parse with default flags.
pub fn test_parse_fails(pattern: &str) {
    let res = regress::Regex::new(pattern);
    assert!(res.is_err(), "Pattern should not have parsed: {}", pattern);
}

/// Test that \p pattern fails to parse with flags.
pub fn test_parse_fails_flags(pattern: &str, flags: &str) {
    let res = regress::Regex::with_flags(pattern, flags);
    assert!(res.is_err(), "Pattern should not have parsed: {}", pattern);
}

/// Format a Match by inserting commas between all capture groups.
fn format_match(r: &regress::Match, input: &str) -> String {
    let mut result = input[r.range()].to_string();
    for cg in r.captures.iter() {
        result.push(',');
        if let Some(cg) = cg {
            result.push_str(&input[cg.clone()])
        }
    }
    result
}

/// Encode a string as UTF16.
pub fn to_utf16(input: &str) -> Vec<u16> {
    input.encode_utf16().collect()
}

/// Given a range of a string encoded as UTF16, return the corresponding
/// range in the original string (UTF-8).
pub fn range_from_utf16(utf16: &[u16], r: regress::Range) -> regress::Range {
    use std::char::decode_utf16;
    // Figure out start.
    let start_utf8: usize = decode_utf16(utf16[0..r.start].iter().copied())
        .map(|r| r.expect("Invalid UTF16").len_utf8())
        .sum();
    let len_utf8: usize = decode_utf16(utf16[r].iter().copied())
        .map(|r| r.expect("Invalid UTF16").len_utf8())
        .sum();
    start_utf8..(start_utf8 + len_utf8)
}

pub trait StringTestHelpers {
    /// "Fluent" style helper for testing that a String is equal to a str.
    fn test_eq(&self, s: &str);
}

impl StringTestHelpers for String {
    fn test_eq(&self, rhs: &str) {
        assert_eq!(self.as_str(), rhs)
    }
}

pub trait VecTestHelpers {
    /// "Fluent" style helper for testing that a Vec<&str> is equal to a
    /// Vec<&str>.
    fn test_eq(&self, rhs: Vec<&str>);
}

impl VecTestHelpers for Vec<&str> {
    fn test_eq(&self, rhs: Vec<&str>) {
        assert_eq!(*self, rhs)
    }
}

/// A compiled regex which remembers a TestConfig.
#[derive(Debug, Clone)]
pub struct TestCompiledRegex {
    re: regress::Regex,
    tc: TestConfig,
}

impl TestCompiledRegex {
    /// Search for self in \p input, returning a list of all matches.
    #[track_caller]
    pub fn matches(&'_ self, input: &'_ str, start: usize) -> Vec<regress::Match> {
        use regress::backends as rbe;
        #[cfg(feature = "utf16")]
        {
            // We don't test the PikeVM backend with UTF16 or UCS2.
            if self.tc.encoding == Encoding::Utf16 {
                return self.match_utf16(input, start);
            } else if self.tc.encoding == Encoding::Ucs2 {
                // Don't test with UCS-2 if the input contains a surrogate pair,
                // as the tests expect these to pass. UCS-2 is tested separately
                // in other places.
                if input.chars().any(|c| c > '\u{FFFF}') {
                    return self.match_utf16(input, start);
                }
                return self.match_ucs2(input, start);
            }
        }
        match (self.tc.use_ascii(input), self.tc.backend) {
            #[cfg(feature = "backend-pikevm")]
            (true, Backend::PikeVM) => {
                rbe::find::<rbe::PikeVMExecutor>(&self.re, input, start).collect()
            }

            #[cfg(feature = "backend-pikevm")]
            (false, Backend::PikeVM) => {
                rbe::find::<rbe::PikeVMExecutor>(&self.re, input, start).collect()
            }

            (true, Backend::Backtracking) => {
                rbe::find_ascii::<rbe::BacktrackExecutor>(&self.re, input, start).collect()
            }

            (false, Backend::Backtracking) => {
                rbe::find::<rbe::BacktrackExecutor>(&self.re, input, start).collect()
            }
        }
    }

    /// Encode a string as UTF16, and match against it as UTF16.
    /// 'start' is given as the byte offset into the UTF8 string.
    #[cfg(feature = "utf16")]
    #[track_caller]
    pub fn match_utf16(&self, input: &str, start: usize) -> Vec<regress::Match> {
        // convert the input and start to UTF16.
        let u16_start = input[..start].chars().map(char::len_utf16).sum();
        let u16_input = to_utf16(input);
        let mut matches: Vec<_> = self.re.find_from_utf16(&u16_input, u16_start).collect();
        // Convert any ranges back to UTF8.
        for matc in matches.iter_mut() {
            matc.range = range_from_utf16(&u16_input, matc.range());
            for r in matc.captures.iter_mut().flatten() {
                *r = range_from_utf16(&u16_input, r.clone());
            }
        }
        matches
    }

    /// Encode a string as UTF16, and match against it as UCS2.
    #[cfg(feature = "utf16")]
    #[track_caller]
    pub fn match_ucs2(&self, input: &str, start: usize) -> Vec<regress::Match> {
        let u16_start = input[..start].chars().map(char::len_utf16).sum();
        let u16_input = to_utf16(input);
        let mut matches: Vec<_> = self.re.find_from_ucs2(&u16_input, u16_start).collect();
        // Convert any ranges back to UTF8.
        for matc in matches.iter_mut() {
            matc.range = range_from_utf16(&u16_input, matc.range());
            for r in matc.captures.iter_mut().flatten() {
                *r = range_from_utf16(&u16_input, r.clone());
            }
        }
        matches
    }

    /// Search for self in \p input, returning the first Match, or None if
    /// none.
    pub fn find(&self, input: &str) -> Option<regress::Match> {
        self.matches(input, 0).into_iter().next()
    }

    /// Like find(), but for UTF-16.
    #[cfg(feature = "utf16")]
    pub fn find_utf16(&self, input: &str) -> Option<regress::Match> {
        self.match_utf16(input, 0).into_iter().next()
    }

    /// Like find(), but for UCS2.
    #[cfg(feature = "utf16")]
    pub fn find_ucs2(&self, input: &str) -> Option<regress::Match> {
        self.match_ucs2(input, 0).into_iter().next()
    }

    /// Match against a string, returning the first formatted match.
    #[track_caller]
    pub fn match1f(&self, input: &str) -> String {
        match self.find(input) {
            Some(m) => format_match(&m, input),
            None => panic!("Failed to match {}", input),
        }
    }

    /// Match against a string, returning the string of the named capture group given.
    pub fn match1_named_group(&self, input: &str, group: &str) -> String {
        match self.find(input) {
            Some(m) => match m.named_group(group) {
                Some(r) => match input.get(r.clone()) {
                    Some(str) => str.to_string(),
                    None => panic!("Cannot get range from string input {:?}", r),
                },
                None => panic!("Named capture group does not exist {}", group),
            },
            None => panic!("Failed to match {}", input),
        }
    }

    /// Match against a string, returning the match as a Vec containing None
    /// for unmatched groups, or the matched strings.
    pub fn match1_vec<'b>(&self, input: &'b str) -> Vec<Option<&'b str>> {
        let mut result = Vec::new();
        let m: regress::Match = self.find(input).expect("Failed to match");
        result.push(Some(&input[m.range()]));
        for cr in m.captures {
            result.push(cr.map(|r| &input[r]));
        }
        result
    }

    /// Test that matching against \p input fails.
    #[track_caller]
    pub fn test_fails(&self, input: &str) {
        assert!(self.find(input).is_none(), "Should not have matched")
    }

    /// Test that matching against \p input succeeds.
    #[track_caller]
    pub fn test_succeeds(&self, input: &str) {
        assert!(self.find(input).is_some(), "Should have matched")
    }

    /// Return a list of all non-overlapping total match ranges from a given
    /// start.
    pub fn match_all_from(&'_ self, input: &'_ str, start: usize) -> Vec<regress::Range> {
        self.matches(input, start)
            .into_iter()
            .map(move |m| m.range())
            .collect()
    }

    /// Return a list of all non-overlapping matches.
    pub fn match_all<'b>(&self, input: &'b str) -> Vec<&'b str> {
        self.matches(input, 0)
            .into_iter()
            .map(move |m| &input[m.range()])
            .collect()
    }

    /// Collect all matches into a String, separated by commas.
    pub fn run_global_match(&self, input: &str) -> String {
        self.matches(input, 0)
            .into_iter()
            .map(move |m| format_match(&m, input))
            .collect::<Vec<String>>()
            .join(",")
    }
}

/// Our backend types.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
enum Backend {
    #[cfg(feature = "backend-pikevm")]
    PikeVM,
    Backtracking,
}

/// Our encoding types.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
enum Encoding {
    Utf8,
    Utf16,
    Ucs2,
}

/// Description of how to test a regex.
#[derive(Debug, Copy, Clone)]
pub struct TestConfig {
    // Whether to prefer ASCII forms if the input is ASCII.
    ascii: bool,

    // Whether to optimize.
    optimize: bool,

    // Which backend to use.
    backend: Backend,

    // Which encoding to use. Only used if utf16 is enabled.
    #[allow(dead_code)]
    encoding: Encoding,
}

impl TestConfig {
    /// Whether to use ASCII for this input.
    pub fn use_ascii(&self, s: &str) -> bool {
        self.ascii && s.is_ascii()
    }

    /// Compile a pattern to a regex, with default flags.
    pub fn compile(&self, pattern: &str) -> TestCompiledRegex {
        self.compilef(pattern, "")
    }

    /// Compile a pattern to a regex, with given flags.
    #[track_caller]
    pub fn compilef(&self, pattern: &str, flags_str: &str) -> TestCompiledRegex {
        let mut flags = regress::Flags::from(flags_str);
        flags.no_opt = !self.optimize;

        let re = regress::Regex::with_flags(pattern, flags);
        assert!(
            re.is_ok(),
            "Failed to parse! flags: {} pattern: {}, error: {}",
            flags_str,
            pattern,
            re.unwrap_err()
        );
        TestCompiledRegex {
            re: re.unwrap(),
            tc: *self,
        }
    }

    /// Test that \p pattern and \p flags successfully parses, and matches
    /// \p input.
    #[track_caller]
    pub fn test_match_succeeds(&self, pattern: &str, flags_str: &str, input: &str) {
        let cr = self.compilef(pattern, flags_str);
        cr.test_succeeds(input)
    }

    /// Test that \p pattern and \p flags successfully parses, and does not
    /// match \p input.
    pub fn test_match_fails(&self, pattern: &str, flags_str: &str, input: &str) {
        let cr = self.compilef(pattern, flags_str);
        cr.test_fails(input)
    }
}

/// Invoke \p F with each test config, in turn.
pub fn test_with_configs<F>(func: F)
where
    F: Fn(TestConfig),
{
    let encoding = Encoding::Utf8;
    // Note we wish to be able to determine the TestConfig from the line number.
    #[cfg(feature = "backend-pikevm")]
    {
        func(TestConfig {
            ascii: true,
            optimize: false,
            backend: Backend::PikeVM,
            encoding,
        });
        func(TestConfig {
            ascii: false,
            optimize: false,
            backend: Backend::PikeVM,
            encoding,
        });
        func(TestConfig {
            ascii: true,
            optimize: true,
            backend: Backend::PikeVM,
            encoding,
        });
        func(TestConfig {
            ascii: false,
            optimize: true,
            backend: Backend::PikeVM,
            encoding,
        });
    }
    func(TestConfig {
        ascii: true,
        optimize: false,
        backend: Backend::Backtracking,
        encoding,
    });
    func(TestConfig {
        ascii: false,
        optimize: false,
        backend: Backend::Backtracking,
        encoding,
    });
    func(TestConfig {
        ascii: true,
        optimize: true,
        backend: Backend::Backtracking,
        encoding,
    });
    func(TestConfig {
        ascii: false,
        optimize: true,
        backend: Backend::Backtracking,
        encoding,
    });

    // UTF16 and UCS2.
    if cfg!(feature = "utf16") {
        func(TestConfig {
            ascii: false,
            optimize: false,
            backend: Backend::Backtracking,
            encoding: Encoding::Utf16,
        });

        func(TestConfig {
            ascii: false,
            optimize: true,
            backend: Backend::Backtracking,
            encoding: Encoding::Utf16,
        });

        func(TestConfig {
            ascii: false,
            optimize: false,
            backend: Backend::Backtracking,
            encoding: Encoding::Ucs2,
        });

        func(TestConfig {
            ascii: false,
            optimize: true,
            backend: Backend::Backtracking,
            encoding: Encoding::Ucs2,
        });
    }
}

/// Invoke `F` with each test config.
/// Exclude ASCII tests.
pub fn test_with_configs_no_ascii<F>(func: F)
where
    F: Fn(TestConfig),
{
    // Note we wish to be able to determine the TestConfig from the line number.
    #[cfg(feature = "backend-pikevm")]
    {
        func(TestConfig {
            ascii: false,
            optimize: false,
            backend: Backend::PikeVM,
            encoding: Encoding::Utf8,
        });
        func(TestConfig {
            ascii: false,
            optimize: true,
            backend: Backend::PikeVM,
            encoding: Encoding::Utf8,
        });
    }
    func(TestConfig {
        ascii: false,
        optimize: false,
        backend: Backend::Backtracking,
        encoding: Encoding::Utf8,
    });
    func(TestConfig {
        ascii: false,
        optimize: true,
        backend: Backend::Backtracking,
        encoding: Encoding::Utf8,
    });

    // UTF16 and UCS2.
    if cfg!(feature = "utf16") {
        func(TestConfig {
            ascii: false,
            optimize: false,
            backend: Backend::Backtracking,
            encoding: Encoding::Utf16,
        });

        func(TestConfig {
            ascii: false,
            optimize: true,
            backend: Backend::Backtracking,
            encoding: Encoding::Utf16,
        });

        func(TestConfig {
            ascii: false,
            optimize: false,
            backend: Backend::Backtracking,
            encoding: Encoding::Ucs2,
        });

        func(TestConfig {
            ascii: false,
            optimize: true,
            backend: Backend::Backtracking,
            encoding: Encoding::Ucs2,
        });
    }
}
