#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// Helper constants for common time values with detailed documentation
const MIDNIGHT: &str = "0"; // 00:00:00 = 0/24 = 0
const NOON: &str = "0.5"; // 12:00:00 = 12/24 = 0.5
const TIME_14_30: &str = "0.604166667"; // 14:30:00 = 14.5/24 ≈ 0.604166667
const TIME_14_30_45: &str = "0.6046875"; // 14:30:45 = 14.5125/24 = 0.6046875
const TIME_14_30_59: &str = "0.604849537"; // 14:30:59 (from floored fractional inputs)
const TIME_23_59_59: &str = "0.999988426"; // 23:59:59 = 23.99972.../24 ≈ 0.999988426

// Excel documentation test values with explanations
const TIME_2_24_AM: &str = "0.1"; // 2:24 AM = 2.4/24 = 0.1
const TIME_2_PM: &str = "0.583333333"; // 2:00 PM = 14/24 ≈ 0.583333333
const TIME_6_45_PM: &str = "0.78125"; // 6:45 PM = 18.75/24 = 0.78125
const TIME_6_35_AM: &str = "0.274305556"; // 6:35 AM = 6.583333.../24 ≈ 0.274305556
const TIME_2_30_AM: &str = "0.104166667"; // 2:30 AM = 2.5/24 ≈ 0.104166667
const TIME_1_AM: &str = "0.041666667"; // 1:00 AM = 1/24 ≈ 0.041666667
const TIME_9_PM: &str = "0.875"; // 9:00 PM = 21/24 = 0.875
const TIME_2_AM: &str = "0.083333333"; // 2:00 AM = 2/24 ≈ 0.083333333
                                       // Additional helper: 1-second past midnight (00:00:01)
const TIME_00_00_01: &str = "0.000011574"; // 1 second = 1/86400 ≈ 0.000011574

/// Helper function to set up and evaluate a model with time expressions
fn test_time_expressions<'a>(expressions: &[(&str, &str)]) -> crate::model::Model<'a> {
    let mut model = new_empty_model();
    for (cell, formula) in expressions {
        model._set(cell, formula);
    }
    model.evaluate();
    model
}

/// Helper function to test component extraction for a given time value
/// Returns (hour, minute, second) as strings
fn test_component_extraction(time_value: &str) -> (String, String, String) {
    let model = test_time_expressions(&[
        ("A1", &format!("=HOUR({time_value})")),
        ("B1", &format!("=MINUTE({time_value})")),
        ("C1", &format!("=SECOND({time_value})")),
    ]);
    (
        model._get_text("A1").to_string(),
        model._get_text("B1").to_string(),
        model._get_text("C1").to_string(),
    )
}

#[test]
fn test_excel_timevalue_compatibility() {
    // Test cases based on Excel's official documentation and examples
    let model = test_time_expressions(&[
        // Excel documentation examples
        ("A1", "=TIMEVALUE(\"2:24 AM\")"), // Should be 0.1
        ("A2", "=TIMEVALUE(\"2 PM\")"),    // Should be 0.583333... (14/24)
        ("A3", "=TIMEVALUE(\"6:45 PM\")"), // Should be 0.78125 (18.75/24)
        ("A4", "=TIMEVALUE(\"18:45\")"),   // Same as above, 24-hour format
        // Date-time format (date should be ignored)
        ("B1", "=TIMEVALUE(\"22-Aug-2011 6:35 AM\")"), // Should be ~0.2743
        ("B2", "=TIMEVALUE(\"2023-01-01 14:30:00\")"), // Should be 0.604166667
        // Edge cases that Excel should support
        ("C1", "=TIMEVALUE(\"12:00 AM\")"),    // Midnight: 0
        ("C2", "=TIMEVALUE(\"12:00 PM\")"),    // Noon: 0.5
        ("C3", "=TIMEVALUE(\"11:59:59 PM\")"), // Almost midnight: 0.999988426
        // Single digit variations
        ("D1", "=TIMEVALUE(\"1 AM\")"),  // 1:00 AM
        ("D2", "=TIMEVALUE(\"9 PM\")"),  // 9:00 PM
        ("D3", "=TIMEVALUE(\"12 AM\")"), // Midnight
        ("D4", "=TIMEVALUE(\"12 PM\")"), // Noon
    ]);

    // Excel documentation examples - verify exact values
    assert_eq!(model._get_text("A1"), *TIME_2_24_AM); // 2:24 AM
    assert_eq!(model._get_text("A2"), *TIME_2_PM); // 2 PM = 14:00
    assert_eq!(model._get_text("A3"), *TIME_6_45_PM); // 6:45 PM = 18:45
    assert_eq!(model._get_text("A4"), *TIME_6_45_PM); // 18:45 (24-hour)

    // Date-time formats (date ignored, extract time only)
    assert_eq!(model._get_text("B1"), *TIME_6_35_AM); // 6:35 AM ≈ 0.2743
    assert_eq!(model._get_text("B2"), *TIME_14_30); // 14:30:00

    // Edge cases
    assert_eq!(model._get_text("C1"), *MIDNIGHT); // 12:00 AM = 00:00
    assert_eq!(model._get_text("C2"), *NOON); // 12:00 PM = 12:00
    assert_eq!(model._get_text("C3"), *TIME_23_59_59); // 11:59:59 PM

    // Single digit hours
    assert_eq!(model._get_text("D1"), *TIME_1_AM); // 1:00 AM
    assert_eq!(model._get_text("D2"), *TIME_9_PM); // 9:00 PM = 21:00
    assert_eq!(model._get_text("D3"), *MIDNIGHT); // 12 AM = 00:00
    assert_eq!(model._get_text("D4"), *NOON); // 12 PM = 12:00
}

// Regression for #1403: Excel accepts a fractional part on the seconds of a
// TIMEVALUE string ("4:35:00.5"), and keeps it in the returned day fraction.
// The expected values are written as seconds-of-day / 86400 so they cannot
// drift from the definition; the Excel results quoted in the comments were
// measured and match.
#[test]
fn test_timevalue_fractional_seconds() {
    let model = test_time_expressions(&[
        ("A1", "=TIMEVALUE(\"4:35:00.5\")"), // Excel: 0.19097800925925926
        ("A2", "=TIMEVALUE(\"4:35:00.999\")"), // Excel: 0.19098378472222222
        ("A3", "=TIMEVALUE(\"0:00:00.001\")"), // Excel: 1.15741E-08 (1 ms past midnight)
        // The fraction must survive the 12-hour formats too.
        ("B1", "=TIMEVALUE(\"4:35:00.5 AM\")"), // Excel: 0.19097800925925926
        ("B2", "=TIMEVALUE(\"4:35:00.25 PM\")"), // Excel: 0.6909751157407408
        // And the date is still ignored when a date is present.
        ("C1", "=TIMEVALUE(\"2023-01-01 14:30:00.5\")"), // Excel: 0.6041724537037037
        // Half a second past midnight.
        ("D1", "=TIMEVALUE(\"0:00:00.5\")"), // Excel: 5.787037037037037E-06
        // Without a fractional part nothing changes: "4:35:00" is still
        // 16500 seconds, not 16500 seconds plus a stray nanosecond.
        ("E1", "=TIMEVALUE(\"4:35:00\")"), // Excel: 0.19097222222222221
        ("E2", "=TIMEVALUE(\"11:59:59 PM\")"), // Excel: 0.9999884259259259
    ]);

    // `make lint` denies `panic!`/`expect` in this workspace. A cell that is not a
    // number is still a genuine test failure, so fail loudly here instead.
    let number = |cell: &str| match model.get_cell_value_by_ref(&format!("Sheet1!{cell}")) {
        Ok(crate::cell::CellValue::Number(n)) => n,
        other => unreachable!("{cell} is not a number: {other:?}"),
    };
    let day = |seconds: f64| seconds / 86_400.0;
    let assert_is = |cell: &str, expected: f64| {
        assert!(
            (number(cell) - expected).abs() < 1e-15,
            "{cell}: got {}, want {expected}",
            number(cell)
        );
    };

    // 4:35:00.5 = 16500.5 s
    assert_is("A1", day(4.0 * 3600.0 + 35.0 * 60.0 + 0.5));
    assert_is("A2", day(4.0 * 3600.0 + 35.0 * 60.0 + 0.999));
    // One millisecond past midnight.
    assert_is("A3", day(0.001));
    // AM/PM variants.
    assert_is("B1", day(4.0 * 3600.0 + 35.0 * 60.0 + 0.5));
    assert_is("B2", day(16.0 * 3600.0 + 35.0 * 60.0 + 0.25));
    // The date part is ignored, only the time is returned.
    assert_is("C1", day(14.0 * 3600.0 + 30.0 * 60.0 + 0.5));
    // Half a second past midnight.
    assert_is("D1", day(0.5));
    // Whole seconds are unchanged.
    assert_is("E1", day(4.0 * 3600.0 + 35.0 * 60.0));
    assert_is("E2", day(23.0 * 3600.0 + 59.0 * 60.0 + 59.0));
}

#[test]
fn test_time_function_basic_cases() {
    let model = test_time_expressions(&[
        ("A1", "=TIME(0,0,0)"),    // Midnight
        ("A2", "=TIME(12,0,0)"),   // Noon
        ("A3", "=TIME(14,30,0)"),  // 2:30 PM
        ("A4", "=TIME(23,59,59)"), // Max time
    ]);

    assert_eq!(model._get_text("A1"), *MIDNIGHT);
    assert_eq!(model._get_text("A2"), *NOON);
    assert_eq!(model._get_text("A3"), *TIME_14_30);
    assert_eq!(model._get_text("A4"), *TIME_23_59_59);
}

#[test]
fn test_time_function_normalization() {
    let model = test_time_expressions(&[
        ("A1", "=TIME(25,0,0)"),         // Hours > 24 wrap around
        ("A2", "=TIME(48,0,0)"),         // 48 hours = 0 (2 full days)
        ("A3", "=TIME(0,90,0)"),         // 90 minutes = 1.5 hours
        ("A4", "=TIME(0,0,90)"),         // 90 seconds = 1.5 minutes
        ("A5", "=TIME(14.9,30.9,59.9)"), // Fractional inputs floored to 14:30:59
    ]);

    assert_eq!(model._get_text("A1"), *TIME_1_AM); // 1:00:00
    assert_eq!(model._get_text("A2"), *MIDNIGHT); // 0:00:00
    assert_eq!(model._get_text("A3"), *"0.0625"); // 1:30:00
    assert_eq!(model._get_text("A4"), *"0.001041667"); // 0:01:30
    assert_eq!(model._get_text("A5"), *TIME_14_30_59); // 14:30:59 (floored)
}

#[test]
fn test_time_function_precision_edge_cases() {
    let model = test_time_expressions(&[
        // High precision fractional seconds
        ("A1", "=TIME(14,30,45.999)"), // Fractional seconds should be floored
        ("A2", "=SECOND(TIME(14,30,45.999))"), // Should extract 45, not 46
        // Very large normalization values
        ("B1", "=TIME(999,999,999)"), // Extreme normalization test
        ("B2", "=HOUR(999.5)"),       // Multiple days, extract hour from fractional part
        ("B3", "=MINUTE(999.75)"),    // Multiple days, extract minute
        // Boundary conditions at rollover points
        ("C1", "=TIME(24,60,60)"), // Should normalize to next day (00:01:00)
        ("C2", "=HOUR(0.999999999)"), // Almost 24 hours should be 23
        ("C3", "=MINUTE(0.999999999)"), // Almost 24 hours, extract minutes
        ("C4", "=SECOND(0.999999999)"), // Almost 24 hours, extract seconds
        // Precision at boundaries
        ("D1", "=TIME(23,59,59.999)"), // Very close to midnight
        ("D2", "=TIME(0,0,0.001)"),    // Just after midnight
    ]);

    // Fractional seconds are floored
    assert_eq!(model._get_text("A2"), *"45"); // 45.999 floored to 45

    // Multiple days should work with rem_euclid
    assert_eq!(model._get_text("B2"), *"12"); // 999.5 days, hour = 12 (noon)

    // Boundary normalization
    assert_eq!(model._get_text("C1"), *"0.042361111"); // 24:60:60 = 01:01:00 (normalized)
    assert_eq!(model._get_text("C2"), *"23"); // Almost 24 hours = 23:xx:xx

    // High precision should be handled correctly
    let result_d1 = model._get_text("D1").parse::<f64>().unwrap();
    assert!(result_d1 < 1.0 && result_d1 > 0.999); // Very close to but less than 1.0
}

#[test]
fn test_time_function_errors() {
    let model = test_time_expressions(&[
        ("A1", "=TIME()"),          // Wrong arg count
        ("A2", "=TIME(12)"),        // Wrong arg count
        ("A3", "=TIME(12,30)"),     // Wrong arg count
        ("A4", "=TIME(12,30,0,0)"), // Wrong arg count
        ("B1", "=TIME(-1,0,0)"),    // Negative hour
        ("B2", "=TIME(0,-1,0)"),    // Negative minute
        ("B3", "=TIME(0,0,-1)"),    // Negative second
    ]);

    // Wrong argument count
    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");

    // Negative values should return #NUM! error
    assert_eq!(model._get_text("B1"), *"#NUM!");
    assert_eq!(model._get_text("B2"), *"#NUM!");
    assert_eq!(model._get_text("B3"), *"#NUM!");
}

#[test]
fn test_timevalue_function_formats() {
    let model = test_time_expressions(&[
        // Basic formats
        ("A1", "=TIMEVALUE(\"14:30\")"),
        ("A2", "=TIMEVALUE(\"14:30:45\")"),
        ("A3", "=TIMEVALUE(\"00:00:00\")"),
        // AM/PM formats
        ("B1", "=TIMEVALUE(\"2:30 PM\")"),
        ("B2", "=TIMEVALUE(\"2:30 AM\")"),
        ("B3", "=TIMEVALUE(\"12:00 PM\")"), // Noon
        ("B4", "=TIMEVALUE(\"12:00 AM\")"), // Midnight
        // Single hour with AM/PM (now supported!)
        ("B5", "=TIMEVALUE(\"2 PM\")"),
        ("B6", "=TIMEVALUE(\"2 AM\")"),
        // Case-insensitive suffix
        ("B7", "=TIMEVALUE(\"2 pm\")"),
        ("B8", "=TIMEVALUE(\"2 pM\")"),
        ("B9", "=TIMEVALUE(\"2 Am\")"),
        ("B10", "=TIMEVALUE(\"2 am\")"),
        // Date-time formats (extract time only)
        ("C1", "=TIMEVALUE(\"2023-01-01 14:30:00\")"),
        ("C2", "=TIMEVALUE(\"2023-01-01T14:30:00\")"),
        // Whitespace handling
        ("D1", "=TIMEVALUE(\" 14:30 \")"),
        ("D2", "=TIMEVALUE(\"14:30  \")"),
        ("D3", "=TIMEVALUE(\" 14:30\")"),
        // Whitespace handling for simple AM/PM
        ("E1", "=TIMEVALUE(\"2 pm \")"),
        ("E2", "=TIMEVALUE(\" 2 pm\")"),
        ("E3", "=TIMEVALUE(\"2  am\")"),
        ("E4", "=TIMEVALUE(\"  2  am  \")"),
        // Dot handling for simple AM/PM
        ("F1", "=TIMEVALUE(\"2 am\")"),
        ("F2", "=TIMEVALUE(\"2 PM.\")"),
        ("F3", "=TIMEVALUE(\"2 p.m.\")"),
    ]);

    // Basic formats
    assert_eq!(model._get_text("A1"), *TIME_14_30);
    assert_eq!(model._get_text("A2"), *TIME_14_30_45);
    assert_eq!(model._get_text("A3"), *MIDNIGHT);

    // AM/PM formats
    assert_eq!(model._get_text("B1"), *TIME_14_30); // 2:30 PM = 14:30
    assert_eq!(model._get_text("B2"), *TIME_2_30_AM); // 2:30 AM
    assert_eq!(model._get_text("B3"), *NOON); // 12:00 PM = noon
    assert_eq!(model._get_text("B4"), *MIDNIGHT); // 12:00 AM = midnight

    // Single hour AM/PM formats (now supported!)
    assert_eq!(model._get_text("B5"), *TIME_2_PM); // 2 PM = 14:00
    assert_eq!(model._get_text("B6"), *TIME_2_AM); // 2 AM = 02:00
    assert_eq!(model._get_text("B7"), *TIME_2_PM); // 2 AM = 02:00
    assert_eq!(model._get_text("B8"), *TIME_2_PM); // 2 AM = 02:00
    assert_eq!(model._get_text("B9"), *TIME_2_AM); // 2 AM = 02:00
    assert_eq!(model._get_text("B10"), *TIME_2_AM); // 2 AM = 02:00

    // Date-time formats
    assert_eq!(model._get_text("C1"), *TIME_14_30);
    assert_eq!(model._get_text("C2"), *TIME_14_30);

    // Whitespace
    assert_eq!(model._get_text("D1"), *TIME_14_30);
    assert_eq!(model._get_text("D2"), *TIME_14_30);
    assert_eq!(model._get_text("D3"), *TIME_14_30);

    // Whitespace handling for simple AM/PM
    assert_eq!(model._get_text("E1"), *TIME_2_PM); // 2 AM = 02:00
    assert_eq!(model._get_text("E2"), *TIME_2_PM); // 2 AM = 02:00
    assert_eq!(model._get_text("E3"), *TIME_2_AM); // 2 AM = 02:00
    assert_eq!(model._get_text("E4"), *TIME_2_AM); // 2 AM = 02:00

    // Dot handling for simple AM/PM
    assert_eq!(model._get_text("F1"), *TIME_2_AM); // 2 AM = 02:00
    assert_eq!(model._get_text("F2"), *TIME_2_PM); // 2 PM = 14:00
    assert_eq!(model._get_text("F3"), *"#VALUE!"); // 2 p.m. = #VALUE!
}

#[test]
fn test_timevalue_function_errors() {
    let model = test_time_expressions(&[
        ("A1", "=TIMEVALUE()"),                 // Wrong arg count
        ("A2", "=TIMEVALUE(\"14:30\", \"x\")"), // Wrong arg count
        ("B1", "=TIMEVALUE(\"invalid\")"),      // Invalid format
        ("B2", "=TIMEVALUE(\"25:00\")"),        // Invalid hour
        ("B3", "=TIMEVALUE(\"14:70\")"),        // Invalid minute
        ("B4", "=TIMEVALUE(\"\")"),             // Empty string
        ("B5", "=TIMEVALUE(\"2PM\")"),          // Missing space (still unsupported)
    ]);

    // Wrong argument count should return #ERROR!
    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");

    // Invalid formats should return #VALUE!
    assert_eq!(model._get_text("B1"), *"#VALUE!");
    assert_eq!(model._get_text("B2"), *"#VALUE!");
    assert_eq!(model._get_text("B3"), *"#VALUE!");
    assert_eq!(model._get_text("B4"), *"#VALUE!");
    assert_eq!(model._get_text("B5"), *"#VALUE!"); // "2PM" no space - not supported
}

#[test]
fn test_time_component_extraction_comprehensive() {
    // Test component extraction using helper function for consistency

    // Test basic time values
    let test_cases = [
        (MIDNIGHT, ("0", "0", "0")),         // 00:00:00
        (NOON, ("12", "0", "0")),            // 12:00:00
        (TIME_14_30, ("14", "30", "0")),     // 14:30:00
        (TIME_23_59_59, ("23", "59", "59")), // 23:59:59
    ];

    for (time_value, expected) in test_cases {
        let (hour, minute, second) = test_component_extraction(time_value);
        assert_eq!(hour, expected.0, "Hour mismatch for {time_value}");
        assert_eq!(minute, expected.1, "Minute mismatch for {time_value}");
        assert_eq!(second, expected.2, "Second mismatch for {time_value}");
    }

    // Test multiple days (extract from fractional part)
    let (hour, minute, second) = test_component_extraction("1.5"); // Day 2, 12:00
    assert_eq!(
        (hour, minute, second),
        ("12".to_string(), "0".to_string(), "0".to_string())
    );

    let (hour, minute, second) = test_component_extraction("100.604166667"); // Day 101, 14:30
    assert_eq!(
        (hour, minute, second),
        ("14".to_string(), "30".to_string(), "0".to_string())
    );

    // Test precision at boundaries
    let (hour, _, _) = test_component_extraction("0.041666666"); // Just under 1:00 AM
    assert_eq!(hour, "0");

    let (hour, _, _) = test_component_extraction("0.041666667"); // Exactly 1:00 AM
    assert_eq!(hour, "1");

    let (hour, _, _) = test_component_extraction("0.041666668"); // Just over 1:00 AM
    assert_eq!(hour, "1");

    // Test very large day values
    let (hour, minute, second) = test_component_extraction("1000000.25"); // Million days + 6 hours
    assert_eq!(
        (hour, minute, second),
        ("6".to_string(), "0".to_string(), "0".to_string())
    );
}

#[test]
fn test_time_component_function_errors() {
    let model = test_time_expressions(&[
        // Wrong argument counts
        ("A1", "=HOUR()"),       // No arguments
        ("A2", "=MINUTE()"),     // No arguments
        ("A3", "=SECOND()"),     // No arguments
        ("A4", "=HOUR(1, 2)"),   // Too many arguments
        ("A5", "=MINUTE(1, 2)"), // Too many arguments
        ("A6", "=SECOND(1, 2)"), // Too many arguments
        // Negative values should return #NUM!
        ("B1", "=HOUR(-0.5)"),        // Negative value
        ("B2", "=MINUTE(-1)"),        // Negative value
        ("B3", "=SECOND(-1)"),        // Negative value
        ("B4", "=HOUR(-0.000001)"),   // Slightly negative
        ("B5", "=MINUTE(-0.000001)"), // Slightly negative
        ("B6", "=SECOND(-0.000001)"), // Slightly negative
    ]);

    // Wrong argument count should return #ERROR!
    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"#ERROR!");
    assert_eq!(model._get_text("A6"), *"#ERROR!");

    // Negative values should return #NUM!
    assert_eq!(model._get_text("B1"), *"#NUM!");
    assert_eq!(model._get_text("B2"), *"#NUM!");
    assert_eq!(model._get_text("B3"), *"#NUM!");
    assert_eq!(model._get_text("B4"), *"#NUM!");
    assert_eq!(model._get_text("B5"), *"#NUM!");
    assert_eq!(model._get_text("B6"), *"#NUM!");
}

#[test]
fn test_time_functions_integration() {
    // Test how TIME, TIMEVALUE and component extraction functions work together
    let model = test_time_expressions(&[
        // Create times with both functions
        ("A1", "=TIME(14,30,45)"),
        ("A2", "=TIMEVALUE(\"14:30:45\")"),
        // Extract components from TIME function results
        ("B1", "=HOUR(A1)"),
        ("B2", "=MINUTE(A1)"),
        ("B3", "=SECOND(A1)"),
        // Extract components from TIMEVALUE function results
        ("C1", "=HOUR(A2)"),
        ("C2", "=MINUTE(A2)"),
        ("C3", "=SECOND(A2)"),
        // Test additional TIME variations
        ("D1", "=TIME(14,0,0)"), // 14:00:00
        ("E1", "=HOUR(D1)"),     // Extract hour from 14:00:00
        ("E2", "=MINUTE(D1)"),   // Extract minute from 14:00:00
        ("E3", "=SECOND(D1)"),   // Extract second from 14:00:00
    ]);

    // TIME and TIMEVALUE should produce equivalent results
    assert_eq!(model._get_text("A1"), model._get_text("A2"));

    // Extracting components should work consistently
    assert_eq!(model._get_text("B1"), *"14");
    assert_eq!(model._get_text("B2"), *"30");
    assert_eq!(model._get_text("B3"), *"45");
    assert_eq!(model._get_text("C1"), *"14");
    assert_eq!(model._get_text("C2"), *"30");
    assert_eq!(model._get_text("C3"), *"45");

    // Components from TIME(14,0,0)
    assert_eq!(model._get_text("E1"), *"14");
    assert_eq!(model._get_text("E2"), *"0");
    assert_eq!(model._get_text("E3"), *"0");
}

#[test]
fn test_time_function_extreme_values() {
    // Test missing edge cases: very large fractional inputs
    let model = test_time_expressions(&[
        // Extremely large fractional values to TIME function
        ("A1", "=TIME(999999.9, 999999.9, 999999.9)"), // Very large fractional inputs
        ("A2", "=TIME(1e6, 1e6, 1e6)"),                // Scientific notation inputs
        ("A3", "=TIME(0.000001, 0.000001, 0.000001)"), // Very small fractional inputs
        // Large day values for component extraction (stress test)
        ("B1", "=HOUR(999999.999)"), // Almost a million days
        ("B2", "=MINUTE(999999.999)"),
        ("B3", "=SECOND(999999.999)"),
        // Edge case: exactly 1.0 (should be midnight of next day)
        ("C1", "=HOUR(1.0)"),
        ("C2", "=MINUTE(1.0)"),
        ("C3", "=SECOND(1.0)"),
        // Very high precision values
        ("D1", "=HOUR(0.999999999999)"), // Almost exactly 24:00:00
        ("D2", "=MINUTE(0.999999999999)"),
        ("D3", "=SECOND(0.999999999999)"),
    ]);

    // Large fractional inputs should be floored and normalized
    let result_a1 = model._get_text("A1").parse::<f64>().unwrap();
    assert!(
        (0.0..1.0).contains(&result_a1),
        "Result should be valid time fraction"
    );

    // Component extraction should work with very large values
    let hour_b1 = model._get_text("B1").parse::<i32>().unwrap();
    assert!((0..=23).contains(&hour_b1), "Hour should be 0-23");

    // Exactly 1.0 should be midnight (start of next day)
    assert_eq!(model._get_text("C1"), *"0");
    assert_eq!(model._get_text("C2"), *"0");
    assert_eq!(model._get_text("C3"), *"0");

    // Very high precision should still extract valid components
    let hour_d1 = model._get_text("D1").parse::<i32>().unwrap();
    assert!((0..=23).contains(&hour_d1), "Hour should be 0-23");
}

#[test]
fn test_timevalue_malformed_but_parseable() {
    // Test missing edge case: malformed but potentially parseable strings
    let model = test_time_expressions(&[
        // Test various malformed but potentially parseable time strings
        ("A1", "=TIMEVALUE(\"14:30:00.123\")"), // Milliseconds
        ("A2", "=TIMEVALUE(\"14:30:00.999\")"), // High precision milliseconds
        ("A3", "=TIMEVALUE(\"02:30:00\")"),     // Leading zero hours
        ("A4", "=TIMEVALUE(\"2:05:00\")"),      // Single digit hour, zero-padded minute
        // Boundary cases for AM/PM parsing
        ("B1", "=TIMEVALUE(\"11:59:59 PM\")"), // Just before midnight
        ("B2", "=TIMEVALUE(\"12:00:01 AM\")"), // Just after midnight
        ("B3", "=TIMEVALUE(\"12:00:01 PM\")"), // Just after noon
        ("B4", "=TIMEVALUE(\"11:59:59 AM\")"), // Just before noon
        // Test various date-time combinations
        ("C1", "=TIMEVALUE(\"2023-12-31T23:59:59\")"), // ISO format at year end
        ("C2", "=TIMEVALUE(\"2023-01-01 00:00:01\")"), // New year, just after midnight
        // Test potential edge cases that might still be parseable
        ("D1", "=TIMEVALUE(\"24:00:00\")"), // Should error (invalid hour)
        ("D2", "=TIMEVALUE(\"23:60:00\")"), // Should error (invalid minute)
        ("D3", "=TIMEVALUE(\"23:59:60\")"), // Should error (invalid second)
    ]);

    // Milliseconds are parsed and kept, as Excel does (#1403)
    assert_eq!(model._get_text("A1"), *"0.60416809"); // 14:30:00.123
    assert_eq!(model._get_text("A2"), *"0.604178229"); // 14:30:00.999

    // Leading zeros should work fine
    assert_eq!(model._get_text("A3"), *TIME_2_30_AM); // 02:30:00 should parse as 2:30:00

    // AM/PM boundary cases should work
    let result_b1 = model._get_text("B1").parse::<f64>().unwrap();
    assert!(
        result_b1 > 0.99 && result_b1 < 1.0,
        "11:59:59 PM should be very close to 1.0"
    );

    let result_b2 = model._get_text("B2").parse::<f64>().unwrap();
    assert!(
        result_b2 > 0.0 && result_b2 < 0.01,
        "12:00:01 AM should be very close to 0.0"
    );

    // ISO 8601 format with "T" separator should be parsed correctly
    assert_eq!(model._get_text("C1"), *TIME_23_59_59); // 23:59:59 → almost midnight
    assert_eq!(model._get_text("C2"), *TIME_00_00_01); // 00:00:01 → one second past midnight

    // Time parser normalizes edge cases to midnight (Excel compatibility)
    assert_eq!(model._get_text("D1"), *"0"); // 24:00:00 = midnight of next day
    assert_eq!(model._get_text("D2"), *"0"); // 23:60:00 normalizes to 24:00:00 = midnight
    assert_eq!(model._get_text("D3"), *"0"); // 23:59:60 normalizes to 24:00:00 = midnight
}

#[test]
fn test_performance_stress_with_extreme_values() {
    // Test performance/stress cases with extreme values
    let model = test_time_expressions(&[
        // Very large numbers that should still work
        ("A1", "=TIME(2147483647, 0, 0)"), // Max i32 hours
        ("A2", "=TIME(0, 2147483647, 0)"), // Max i32 minutes
        ("A3", "=TIME(0, 0, 2147483647)"), // Max i32 seconds
        // Component extraction with extreme day values
        ("B1", "=HOUR(1e15)"), // Very large day number
        ("B2", "=MINUTE(1e15)"),
        ("B3", "=SECOND(1e15)"),
        // Edge of floating point precision
        ("C1", "=HOUR(1.7976931348623157e+308)"), // Near max f64
        ("C2", "=HOUR(2.2250738585072014e-308)"), // Near min positive f64
        // Multiple TIME function calls with large values
        ("D1", "=TIME(1000000, 1000000, 1000000)"), // Large normalized values
        ("D2", "=HOUR(D1)"),                        // Extract from large TIME result
        ("D3", "=MINUTE(D1)"),
        ("D4", "=SECOND(D1)"),
    ]);

    // All results should be valid (not errors) even with extreme inputs
    for cell in ["A1", "A2", "A3", "B1", "B2", "B3", "D1", "D2", "D3", "D4"] {
        let result = model._get_text(cell);
        assert!(
            result != *"#ERROR!" && result != *"#NUM!" && result != *"#VALUE!",
            "Cell {cell} should not error with extreme values: {result}",
        );
    }

    // Results should be mathematically valid
    let hour_b1 = model._get_text("B1").parse::<i32>().unwrap();
    let minute_b2 = model._get_text("B2").parse::<i32>().unwrap();
    let second_b3 = model._get_text("B3").parse::<i32>().unwrap();

    assert!((0..=23).contains(&hour_b1));
    assert!((0..=59).contains(&minute_b2));
    assert!((0..=59).contains(&second_b3));

    // TIME function results should be valid time fractions
    let time_d1 = model._get_text("D1").parse::<f64>().unwrap();
    assert!(
        (0.0..1.0).contains(&time_d1),
        "TIME result should be valid fraction"
    );
}
