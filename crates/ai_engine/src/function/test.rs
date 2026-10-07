use super::Function;
use super::testing::{Mock, Noise, obj, stream};
use crate::pdf::Object;

fn close(a: &[f32], b: &[f32]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-4)
}

#[track_caller]
fn assert_close(a: &[f32], b: &[f32]) {
    assert!(close(a, b), "{a:?} != {b:?}");
}

fn parse(src: &str) -> Function {
    Function::parse(&Mock::default(), &obj(src)).expect("function parses")
}

/// A calculator taking `inputs` inputs (at least one) with `range`.
fn calculator(inputs: usize, range: &str, program: &str) -> Function {
    let domain = "-1000 1000 ".repeat(inputs.max(1));
    let s = stream(
        &format!("<< /FunctionType 4 /Domain [{domain}] /Range {range} >>"),
        program.as_bytes(),
    );
    Function::parse(&Mock::default(), &Object::Stream(s)).expect("calculator parses")
}

/// Runs a one-output calculator program on `inputs`.
fn calc(program: &str, inputs: &[f32]) -> f32 {
    calculator(inputs.len(), "[-100000 100000]", program).eval(inputs)[0]
}

#[test]
fn exponential_interpolates_and_clips_the_domain() {
    let f = parse("<< /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >>");
    assert_eq!(f.inputs(), 1);
    assert_eq!(f.outputs(), 3);
    assert_close(&f.eval(&[0.25]), &[0.75, 0.0, 0.25]);
    assert_close(&f.eval(&[2.0]), &[0.0, 0.0, 1.0]);
    assert_close(&f.eval(&[-1.0]), &[1.0, 0.0, 0.0]);
    // Defaults: C0 [0], C1 [1].
    let squared = parse("<< /FunctionType 2 /Domain [0 1] /N 2 >>");
    assert_close(&squared.eval(&[0.5]), &[0.25]);
}

#[test]
fn exponential_clips_the_range() {
    let f = parse("<< /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [2] /N 1 /Range [0 1] >>");
    assert_close(&f.eval(&[0.25]), &[0.5]);
    assert_close(&f.eval(&[0.75]), &[1.0]);
}

#[test]
fn stitching_picks_the_subdomain_and_encodes() {
    let f = parse(
        "<< /FunctionType 3 /Domain [0 1] /Bounds [0.5] /Encode [0 1 1 0]
           /Functions [
             << /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 1 >>
             << /FunctionType 2 /Domain [0 1] /C0 [10] /C1 [20] /N 1 >>
           ] >>",
    );
    assert_close(&f.eval(&[0.0]), &[0.0]);
    assert_close(&f.eval(&[0.25]), &[0.5]);
    // The second subdomain's encoding runs backwards.
    assert_close(&f.eval(&[0.5]), &[20.0]);
    assert_close(&f.eval(&[0.75]), &[15.0]);
    assert_close(&f.eval(&[1.0]), &[10.0]);
    assert_eq!(f.bounds(), &[0.5]);
}

#[test]
fn stitching_with_an_empty_subdomain_uses_its_encode_start() {
    let f = parse(
        "<< /FunctionType 3 /Domain [0 1] /Bounds [0 1] /Encode [0 1 0 1 0 1]
           /Functions [
             << /FunctionType 2 /Domain [0 1] /C0 [1] /C1 [2] /N 1 >>
             << /FunctionType 2 /Domain [0 1] /C0 [3] /C1 [4] /N 1 >>
             << /FunctionType 2 /Domain [0 1] /C0 [5] /C1 [6] /N 1 >>
           ] >>",
    );
    assert_close(&f.eval(&[0.5]), &[3.5]);
    assert_close(&f.eval(&[1.0]), &[5.0]);
}

#[test]
fn function_arrays_act_as_one() {
    let f = parse(
        "[ << /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 1 >>
           << /FunctionType 2 /Domain [0 1] /C0 [1] /C1 [0] /N 1 >> ]",
    );
    assert_eq!(f.outputs(), 2);
    assert_close(&f.eval(&[0.25]), &[0.25, 0.75]);
}

#[test]
fn nested_functions_are_bounded() {
    let mut mock = Mock::default();
    // A stitching function that contains itself.
    let me = Object::Ref(crate::pdf::ObjRef::new(1, 0));
    mock.add(
        1,
        obj("<< /FunctionType 3 /Domain [0 1] /Bounds [] /Encode [0 1] /Functions [1 0 R] >>"),
    );
    assert!(Function::parse(&mock, &me).is_err());
}

#[test]
fn sampled_one_input_interpolates_linearly() {
    let s = stream(
        "<< /FunctionType 0 /Domain [0 1] /Range [0 1] /Size [3] /BitsPerSample 8 >>",
        &[0, 255, 51],
    );
    let f = Function::parse(&Mock::default(), &Object::Stream(s)).unwrap();
    assert_close(&f.eval(&[0.0]), &[0.0]);
    assert_close(&f.eval(&[0.25]), &[0.5]);
    assert_close(&f.eval(&[0.5]), &[1.0]);
    assert_close(&f.eval(&[0.75]), &[0.6]);
    assert_close(&f.eval(&[1.0]), &[0.2]);
}

#[test]
fn sampled_two_inputs_interpolate_bilinearly() {
    // 2 × 2 samples, two outputs each, first input fastest.
    let s = stream(
        "<< /FunctionType 0 /Domain [0 1 0 1] /Range [0 1 0 1] /Size [2 2] /BitsPerSample 8 >>",
        &[0, 255, 255, 255, 0, 0, 255, 0],
    );
    let f = Function::parse(&Mock::default(), &Object::Stream(s)).unwrap();
    assert_close(&f.eval(&[0.0, 0.0]), &[0.0, 1.0]);
    assert_close(&f.eval(&[1.0, 0.0]), &[1.0, 1.0]);
    assert_close(&f.eval(&[0.0, 1.0]), &[0.0, 0.0]);
    assert_close(&f.eval(&[1.0, 1.0]), &[1.0, 0.0]);
    assert_close(&f.eval(&[0.5, 0.5]), &[0.5, 0.5]);
    assert_close(&f.eval(&[0.25, 0.75]), &[0.25, 0.25]);
}

#[test]
fn sampled_bit_depths_encode_and_decode() {
    let cases: [(u32, &[u8], f32); 6] = [
        // Four 1-bit samples: 1 0 1 1.
        (1, &[0b1011_0000], 1.0),
        // Four 2-bit samples: 3 0 2 1.
        (2, &[0b1100_1001], 1.0 / 3.0),
        // Four 4-bit samples: 15 0 8 4.
        (4, &[0xf0, 0x84], 4.0 / 15.0),
        // Four 12-bit samples: 4095 0 2048 1024.
        (12, &[0xff, 0xf0, 0x00, 0x80, 0x04, 0x00], 1024.0 / 4095.0),
        // Four 16-bit samples.
        (16, &[0xff, 0xff, 0, 0, 0x80, 0, 0x40, 0], 16384.0 / 65535.0),
        // Four 32-bit samples.
        (
            32,
            &[
                0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0, 0x80, 0, 0, 0, 0x40, 0, 0, 0,
            ],
            0.25,
        ),
    ];
    for (bits, data, last) in cases {
        let s = stream(
            &format!(
                "<< /FunctionType 0 /Domain [0 3] /Range [0 1] /Size [4] /BitsPerSample {bits} >>"
            ),
            data,
        );
        let f = Function::parse(&Mock::default(), &Object::Stream(s)).unwrap();
        assert_close(&f.eval(&[0.0]), &[1.0]);
        assert_close(&f.eval(&[1.0]), &[0.0]);
        assert_close(&f.eval(&[3.0]), &[last]);
    }
    // Encode maps the domain onto samples backwards; Decode scales them.
    let s = stream(
        "<< /FunctionType 0 /Domain [0 1] /Range [0 10] /Size [2] /BitsPerSample 8
           /Encode [1 0] /Decode [0 10] >>",
        &[0, 255],
    );
    let f = Function::parse(&Mock::default(), &Object::Stream(s)).unwrap();
    assert_close(&f.eval(&[0.0]), &[10.0]);
    assert_close(&f.eval(&[0.75]), &[2.5]);
}

#[test]
fn sampled_short_data_reads_as_zeros_and_bad_sizes_fail() {
    let s = stream(
        "<< /FunctionType 0 /Domain [0 1] /Range [0 1] /Size [2] /BitsPerSample 8 >>",
        &[255],
    );
    let f = Function::parse(&Mock::default(), &Object::Stream(s)).unwrap();
    assert_close(&f.eval(&[1.0]), &[0.0]);
    let huge = stream(
        "<< /FunctionType 0 /Domain [0 1 0 1] /Range [0 1] /Size [100000 100000] /BitsPerSample 8 >>",
        &[],
    );
    assert!(Function::parse(&Mock::default(), &Object::Stream(huge)).is_err());
    let no_range = stream(
        "<< /FunctionType 0 /Domain [0 1] /Size [2] /BitsPerSample 8 >>",
        &[0, 1],
    );
    assert!(Function::parse(&Mock::default(), &Object::Stream(no_range)).is_err());
}

#[test]
fn calculator_arithmetic() {
    assert_eq!(calc("{ 2 3 add }", &[]), 5.0);
    assert_eq!(calc("{ 2 3 sub }", &[]), -1.0);
    assert_eq!(calc("{ 2.5 4 mul }", &[]), 10.0);
    assert_eq!(calc("{ 7 2 div }", &[]), 3.5);
    assert_eq!(calc("{ 7 2 idiv }", &[]), 3.0);
    assert_eq!(calc("{ -7 2 idiv }", &[]), -3.0);
    assert_eq!(calc("{ 7 3 mod }", &[]), 1.0);
    assert_eq!(calc("{ -7 3 mod }", &[]), -1.0);
    // Division by zero gives 0 rather than failing.
    assert_eq!(calc("{ 7 0 div 1 add }", &[]), 1.0);
    assert_eq!(calc("{ 7 0 idiv 7 0 mod add }", &[]), 0.0);
    assert_eq!(calc("{ -3.5 abs }", &[]), 3.5);
    assert_eq!(calc("{ 4 neg }", &[]), -4.0);
    assert_eq!(calc("{ 2.1 ceiling }", &[]), 3.0);
    assert_eq!(calc("{ -2.1 floor }", &[]), -3.0);
    assert_eq!(calc("{ 2.5 round }", &[]), 3.0);
    assert_eq!(calc("{ -2.5 round }", &[]), -2.0);
    assert_eq!(calc("{ -2.7 truncate }", &[]), -2.0);
    assert_eq!(calc("{ 2.7 cvi }", &[]), 2.0);
    assert_eq!(calc("{ 2 cvr 3 div }", &[]), 2.0 / 3.0);
    assert_eq!(calc("{ 16 sqrt }", &[]), 4.0);
    assert_eq!(calc("{ 2 10 exp }", &[]), 1024.0);
    assert!((calc("{ 2.718281828 ln }", &[]) - 1.0).abs() < 1e-6);
    assert!((calc("{ 1000 log }", &[]) - 3.0).abs() < 1e-6);
    assert!((calc("{ 30 sin }", &[]) - 0.5).abs() < 1e-6);
    assert!((calc("{ 60 cos }", &[]) - 0.5).abs() < 1e-6);
    assert!((calc("{ 1 1 atan }", &[]) - 45.0).abs() < 1e-4);
    assert!((calc("{ -1 0 atan }", &[]) - 270.0).abs() < 1e-4);
    // Inputs arrive on the stack.
    assert_eq!(calc("{ 2 mul 1 add }", &[3.0]), 7.0);
    assert_eq!(calc("{ add }", &[3.0, 4.0]), 7.0);
}

#[test]
fn calculator_relational_boolean_and_bitwise() {
    assert_eq!(calc("{ 1 2 lt { 1 } { 0 } ifelse }", &[]), 1.0);
    assert_eq!(calc("{ 2 2 le { 1 } { 0 } ifelse }", &[]), 1.0);
    assert_eq!(calc("{ 1 2 gt { 1 } { 0 } ifelse }", &[]), 0.0);
    assert_eq!(calc("{ 2 2 ge { 1 } { 0 } ifelse }", &[]), 1.0);
    assert_eq!(calc("{ 2 2.0 eq { 1 } { 0 } ifelse }", &[]), 1.0);
    assert_eq!(calc("{ 2 3 ne { 1 } { 0 } ifelse }", &[]), 1.0);
    assert_eq!(calc("{ true false and { 1 } { 0 } ifelse }", &[]), 0.0);
    assert_eq!(calc("{ true false or { 1 } { 0 } ifelse }", &[]), 1.0);
    assert_eq!(calc("{ true true xor { 1 } { 0 } ifelse }", &[]), 0.0);
    assert_eq!(calc("{ false not { 1 } { 0 } ifelse }", &[]), 1.0);
    assert_eq!(calc("{ 12 10 and }", &[]), 8.0);
    assert_eq!(calc("{ 12 10 or }", &[]), 14.0);
    assert_eq!(calc("{ 12 10 xor }", &[]), 6.0);
    assert_eq!(calc("{ 0 not }", &[]), -1.0);
    assert_eq!(calc("{ 1 4 bitshift }", &[]), 16.0);
    assert_eq!(calc("{ 256 -4 bitshift }", &[]), 16.0);
}

#[test]
fn calculator_conditionals_nest() {
    let program = "{ dup 0.5 lt { 0.25 lt { 1 } { 2 } ifelse } { pop 3 } ifelse }";
    assert_eq!(calc(program, &[0.1]), 1.0);
    assert_eq!(calc(program, &[0.3]), 2.0);
    assert_eq!(calc(program, &[0.9]), 3.0);
    // `if` without else; the condition consumed either way.
    assert_eq!(calc("{ dup 0.5 gt { 2 mul } if }", &[0.75]), 1.5);
    assert_eq!(calc("{ dup 0.5 gt { 2 mul } if }", &[0.25]), 0.25);
}

#[test]
fn calculator_stack_operators() {
    // (Each program starts with its one input on the stack.)
    let f = calculator(1, "[0 100 0 100 0 100]", "{ 1 2 3 3 1 roll }");
    assert_eq!(f.eval(&[]), vec![3.0, 1.0, 2.0]);
    let f = calculator(1, "[0 100 0 100 0 100]", "{ 1 2 3 3 -1 roll }");
    assert_eq!(f.eval(&[]), vec![2.0, 3.0, 1.0]);
    let f = calculator(1, "[0 100 0 100 0 100 0 100]", "{ 1 2 2 copy }");
    assert_eq!(f.eval(&[]), vec![1.0, 2.0, 1.0, 2.0]);
    let f = calculator(1, "[0 100 0 100 0 100 0 100]", "{ 1 2 3 2 index }");
    assert_eq!(f.eval(&[]), vec![1.0, 2.0, 3.0, 1.0]);
    let f = calculator(1, "[0 100 0 100]", "{ 1 2 exch }");
    assert_eq!(f.eval(&[]), vec![2.0, 1.0]);
    let f = calculator(1, "[0 100 0 100]", "{ 5 dup }");
    assert_eq!(f.eval(&[]), vec![5.0, 5.0]);
    let f = calculator(1, "[0 100]", "{ 5 6 pop }");
    assert_eq!(f.eval(&[]), vec![5.0]);
}

#[test]
fn calculator_failures_give_zeros_and_bad_programs_fail_to_parse() {
    // Underflow (the one input is not enough for `add`).
    assert_eq!(calc("{ add 1 add }", &[]), 0.0);
    // Overflow past 100 operands.
    let deep = format!("{{ {} }}", "1 ".repeat(100));
    assert_eq!(calc(&deep, &[]), 0.0);
    // Too few results.
    let f = calculator(1, "[0 1 0 1]", "{ pop 1 }");
    assert_eq!(f.eval(&[0.5]), vec![0.0, 0.0]);
    let mock = Mock::default();
    for bad in ["{ 1 foo }", "{ 1 2", "1 2 add", "{ { 1 } }", "{ if }"] {
        let s = stream(
            "<< /FunctionType 4 /Domain [0 1] /Range [0 1] >>",
            bad.as_bytes(),
        );
        assert!(
            Function::parse(&mock, &Object::Stream(s)).is_err(),
            "{bad} should not parse"
        );
    }
}

#[test]
fn calculator_clips_to_its_range() {
    let f = calculator(1, "[0 1]", "{ 5 }");
    assert_eq!(f.eval(&[]), vec![1.0]);
}

#[test]
fn calculator_runs_a_devicen_tint_transform() {
    // From a DeviceN [/Black] space: a tint to CMYK (0 0 0 tint).
    let program = "{1.000000 2 1 roll 1.000000 2 1 roll 1.000000 2 1 roll 0 index 1.000000 \n\
                   cvr exch sub 2 1 roll 5 -1 roll 1.000000 cvr exch sub 5 1 \n\
                   roll 4 -1 roll 1.000000 cvr exch sub 4 1 roll 3 -1 roll 1.000000 \n\
                   cvr exch sub 3 1 roll 2 -1 roll 1.000000 cvr exch sub 2 1 \n\
                   roll pop }";
    let s = stream(
        "<< /FunctionType 4 /Domain [0 1] /Range [0 1 0 1 0 1 0 1] >>",
        program.as_bytes(),
    );
    let f = Function::parse(&Mock::default(), &Object::Stream(s)).unwrap();
    assert_close(&f.eval(&[0.3]), &[0.0, 0.0, 0.0, 0.3]);
}

#[test]
fn garbage_programs_and_samples_never_panic() {
    let mut noise = Noise(7);
    let words = [
        "{",
        "}",
        "{",
        "}",
        "if",
        "ifelse",
        "1",
        "-2",
        "0.5",
        "1e30",
        "-1e-30",
        "0",
        "add",
        "sub",
        "mul",
        "div",
        "idiv",
        "mod",
        "neg",
        "abs",
        "atan",
        "cos",
        "sin",
        "exp",
        "ln",
        "log",
        "sqrt",
        "cvi",
        "cvr",
        "round",
        "floor",
        "ceiling",
        "truncate",
        "and",
        "or",
        "xor",
        "not",
        "bitshift",
        "eq",
        "ne",
        "gt",
        "ge",
        "lt",
        "le",
        "true",
        "false",
        "copy",
        "dup",
        "exch",
        "index",
        "pop",
        "roll",
        "99",
        "-99",
        "16#7FFFFFFF",
    ];
    let mock = Mock::default();
    for _ in 0..400 {
        let len = noise.below(60);
        let body: Vec<&str> = (0..len).map(|_| *noise.pick(&words)).collect();
        let program = format!("{{ {} }}", body.join(" "));
        let s = stream(
            "<< /FunctionType 4 /Domain [-10 10 -10 10] /Range [-1e9 1e9 -1e9 1e9 -1e9 1e9] >>",
            program.as_bytes(),
        );
        if let Ok(f) = Function::parse(&mock, &Object::Stream(s)) {
            let inputs = [noise.below(2000) as f32 / 100.0 - 10.0, 3.0];
            let out = f.eval(&inputs);
            assert!(out.iter().all(|v| v.is_finite()), "{program}: {out:?}");
        }
    }
    for _ in 0..200 {
        let bits = *noise.pick(&[1, 2, 4, 8, 12, 16, 24, 32, 3, 0]);
        let (a, b) = (noise.below(5), noise.below(5));
        let len = noise.below(40) as usize;
        let data = noise.bytes(len);
        let s = stream(
            &format!(
                "<< /FunctionType 0 /Domain [0 1 0 1] /Range [0 1 -5 5] /Size [{a} {b}]
                    /BitsPerSample {bits} /Encode [0 9 -3 1] >>"
            ),
            &data,
        );
        if let Ok(f) = Function::parse(&mock, &Object::Stream(s)) {
            for x in [-1.0, 0.0, 0.3, 1.0, 2.0, f32::NAN] {
                let out = f.eval(&[x, 1.0 - x]);
                assert!(out.iter().all(|v| v.is_finite()));
            }
        }
    }
}
