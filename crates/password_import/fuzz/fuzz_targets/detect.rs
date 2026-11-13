#![no_main]

libfuzzer_sys::fuzz_target!(|bytes: &[u8]| {
    let _ = password_import::detect(bytes, &password_import::Limits::default());
});
