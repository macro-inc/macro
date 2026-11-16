#![no_main]

use password_import::{Limits, SourceFormat, parse};

libfuzzer_sys::fuzz_target!(|bytes: &[u8]| {
    if let Ok(export) = parse(bytes, SourceFormat::OnePasswordPux, &Limits::default()) {
        let _ = export.summary();
    }
});
