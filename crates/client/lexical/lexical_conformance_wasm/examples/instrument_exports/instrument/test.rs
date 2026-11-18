use super::*;
use std::{
    io::Write,
    process::{Command, Stdio},
};
use wasm_encoder::{
    ConstExpr, EntityType, ExportKind, GlobalSection, GlobalType, ImportSection, StartSection,
    TypeSection, ValType,
};

#[test]
fn actual_export_entries_count_aliases_internal_calls_traps_and_repeated_frees() {
    let mut module = Module::new();
    let mut types = TypeSection::new();
    types.ty().function([ValType::I32], []);
    types
        .ty()
        .function([ValType::I32], [ValType::I32, ValType::I64]);
    types.ty().function([], []);
    types.ty().function([ValType::I32, ValType::I32], []);
    module.section(&types);
    let mut imports = ImportSection::new();
    imports.import("env", "foreign", EntityType::Function(1));
    module.section(&imports);
    let mut functions = FunctionSection::new();
    functions
        .function(0)
        .function(1)
        .function(1)
        .function(2)
        .function(3)
        .function(2);
    module.section(&functions);
    let mut globals = GlobalSection::new();
    globals.global(
        GlobalType {
            val_type: ValType::I32,
            mutable: true,
            shared: false,
        },
        &ConstExpr::i32_const(0),
    );
    globals.global(
        GlobalType {
            val_type: ValType::I32,
            mutable: true,
            shared: false,
        },
        &ConstExpr::i32_const(0),
    );
    module.section(&globals);
    let mut exports = ExportSection::new();
    exports.export(HELPER, ExportKind::Func, 1);
    exports.export("pair", ExportKind::Func, 2);
    exports.export("alias", ExportKind::Func, 2);
    exports.export("outer", ExportKind::Func, 3);
    exports.export("trap", ExportKind::Func, 4);
    exports.export("__wbg_test_free", ExportKind::Func, 5);
    exports.export("ordinaryFree", ExportKind::Func, 5);
    exports.export("imported", ExportKind::Func, 0);
    exports.export("counter", ExportKind::Global, 0);
    exports.export("bytes", ExportKind::Global, 1);
    module.section(&exports);
    module.section(&StartSection { function_index: 6 });
    let mut code = CodeSection::new();
    let mut helper = Function::new([]);
    helper.instruction(&Instruction::GlobalGet(0));
    helper.instruction(&Instruction::I32Const(1));
    helper.instruction(&Instruction::I32Add);
    helper.instruction(&Instruction::GlobalSet(0));
    helper.instruction(&Instruction::GlobalGet(1));
    helper.instruction(&Instruction::LocalGet(0));
    helper.instruction(&Instruction::I32Add);
    helper.instruction(&Instruction::GlobalSet(1));
    helper.instruction(&Instruction::End);
    code.function(&helper);
    let mut pair = Function::new([]);
    pair.instruction(&Instruction::LocalGet(0));
    pair.instruction(&Instruction::I64Const(1234));
    pair.instruction(&Instruction::End);
    code.function(&pair);
    let mut outer = Function::new([]);
    outer.instruction(&Instruction::LocalGet(0));
    outer.instruction(&Instruction::Call(2));
    outer.instruction(&Instruction::End);
    code.function(&outer);
    let mut trap = Function::new([]);
    trap.instruction(&Instruction::Unreachable);
    trap.instruction(&Instruction::End);
    code.function(&trap);
    let mut free = Function::new([]);
    free.instruction(&Instruction::End);
    code.function(&free);
    let mut start = Function::new([]);
    start.instruction(&Instruction::I32Const(0));
    start.instruction(&Instruction::Call(2));
    start.instruction(&Instruction::Drop);
    start.instruction(&Instruction::Drop);
    start.instruction(&Instruction::I32Const(40));
    start.instruction(&Instruction::Call(0));
    start.instruction(&Instruction::Drop);
    start.instruction(&Instruction::Drop);
    start.instruction(&Instruction::End);
    code.function(&start);
    module.section(&code);
    let instrumented = instrument_with(&module.finish(), &[]).expect("instrumented module");
    assert!(matches!(
        instrument_with(&instrumented, &[]),
        Err(Error::Invalid("export counters are already instrumented"))
    ));
    let mut process = Command::new("bun")
        .arg(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/examples/instrument_exports/execute.ts"
        ))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("Bun runtime");
    process
        .stdin
        .take()
        .expect("stdin")
        .write_all(&instrumented)
        .expect("input");
    let output = process.wait_with_output().expect("Bun output");
    assert!(output.status.success());
    let result: serde_json::Value = serde_json::from_slice(&output.stdout).expect("result");
    assert_eq!(
        result,
        serde_json::json!({
            "initial":0,"pair":[7,"1234"],"alias":[8,"1234"],"outer":[9,"1234"],
            "counts":[1,2,3,4,5,6,7,8,9,10],"bytes":8,"freeBytes":[0,4,8],"trapped":true,"helperPresent":true,
        "imported":[42,"4321"],"received":[40,41,-1],"importedTrapped":true
        })
    );
}

#[test]
fn missing_and_wrong_helper_signatures_fail_before_producing_an_artifact() {
    assert!(matches!(
        instrument_with(&Module::new().finish(), &[]),
        Err(Error::Invalid("missing export counter helper"))
    ));
    let mut module = Module::new();
    let mut types = TypeSection::new();
    types.ty().function([], []);
    module.section(&types);
    let mut functions = FunctionSection::new();
    functions.function(0);
    module.section(&functions);
    let mut exports = ExportSection::new();
    exports.export(HELPER, ExportKind::Func, 0);
    module.section(&exports);
    let mut code = CodeSection::new();
    let mut helper = Function::new([]);
    helper.instruction(&Instruction::End);
    code.function(&helper);
    module.section(&code);
    assert!(matches!(
        instrument_with(&module.finish(), &[]),
        Err(Error::Invalid(
            "export counter helper must have type (i32) -> ()"
        ))
    ));
}

#[test]
fn helper_aliases_are_rejected_instead_of_counting_the_helper_twice() {
    let mut module = Module::new();
    let mut types = TypeSection::new();
    types.ty().function([ValType::I32], []);
    module.section(&types);
    let mut functions = FunctionSection::new();
    functions.function(0);
    module.section(&functions);
    let mut exports = ExportSection::new();
    exports.export(HELPER, ExportKind::Func, 0);
    exports.export("alias", ExportKind::Func, 0);
    module.section(&exports);
    let mut code = CodeSection::new();
    let mut helper = Function::new([]);
    helper.instruction(&Instruction::End);
    code.function(&helper);
    module.section(&code);
    assert!(matches!(
        instrument_with(&module.finish(), &[]),
        Err(Error::Invalid("export counter helper must have no aliases"))
    ));
}

#[test]
fn changed_generated_free_signatures_fail_instead_of_miscounting_receivers() {
    let mut module = Module::new();
    let mut types = TypeSection::new();
    types.ty().function([ValType::I32], []);
    module.section(&types);
    let mut functions = FunctionSection::new();
    functions.function(0).function(0);
    module.section(&functions);
    let mut exports = ExportSection::new();
    exports.export(HELPER, ExportKind::Func, 0);
    exports.export("__wbg_changed_free", ExportKind::Func, 1);
    module.section(&exports);
    let mut code = CodeSection::new();
    let mut helper = Function::new([]);
    helper.instruction(&Instruction::End);
    code.function(&helper);
    let mut free = Function::new([]);
    free.instruction(&Instruction::End);
    code.function(&free);
    module.section(&code);
    assert!(matches!(
        instrument_with(&module.finish(), &[]),
        Err(Error::Invalid(
            "class free export must have type (i32, i32) -> ()"
        ))
    ));
}

#[test]
fn imported_helper_is_rejected_before_its_missing_body_can_hide_entries() {
    let mut module = Module::new();
    let mut types = TypeSection::new();
    types.ty().function([ValType::I32], []);
    module.section(&types);
    let mut imports = ImportSection::new();
    imports.import("env", "counter", EntityType::Function(0));
    module.section(&imports);
    let mut exports = ExportSection::new();
    exports.export(HELPER, ExportKind::Func, 0);
    module.section(&exports);
    assert!(matches!(
        instrument_with(&module.finish(), &[]),
        Err(Error::Invalid(
            "export counter helper must be a defined function"
        ))
    ));
}

#[test]
fn a_nonfunction_helper_export_is_rejected_before_rewriting() {
    let mut module = Module::new();
    let mut globals = GlobalSection::new();
    globals.global(
        GlobalType {
            val_type: ValType::I32,
            mutable: true,
            shared: false,
        },
        &ConstExpr::i32_const(0),
    );
    module.section(&globals);
    let mut exports = ExportSection::new();
    exports.export(HELPER, ExportKind::Global, 0);
    module.section(&exports);
    assert!(matches!(
        instrument_with(&module.finish(), &[]),
        Err(Error::Invalid(
            "export counter helper must be a defined function"
        ))
    ));
}

#[test]
fn string_payloads_count_utf16_optional_abi_aliases_and_entries_before_memory_traps() {
    use wasm_encoder::{MemorySection, MemoryType};
    let mut module = Module::new();
    let mut types = TypeSection::new();
    types.ty().function([ValType::I32], []);
    types.ty().function([ValType::I64], []);
    types.ty().function([ValType::I32, ValType::I32], []);
    module.section(&types);
    let mut functions = FunctionSection::new();
    functions.function(0).function(1).function(2);
    module.section(&functions);
    let mut memories = MemorySection::new();
    memories.memory(MemoryType {
        minimum: 1,
        maximum: None,
        memory64: false,
        shared: false,
        page_size_log2: None,
    });
    module.section(&memories);
    let mut globals = GlobalSection::new();
    globals.global(
        GlobalType {
            val_type: ValType::I32,
            mutable: true,
            shared: false,
        },
        &ConstExpr::i32_const(0),
    );
    globals.global(
        GlobalType {
            val_type: ValType::I64,
            mutable: true,
            shared: false,
        },
        &ConstExpr::i64_const(0),
    );
    module.section(&globals);
    let mut exports = ExportSection::new();
    exports.export(HELPER, ExportKind::Func, 0);
    exports.export(PAYLOAD, ExportKind::Func, 1);
    exports.export("input", ExportKind::Func, 2);
    exports.export("optional", ExportKind::Func, 2);
    exports.export("memory", ExportKind::Memory, 0);
    exports.export("counter", ExportKind::Global, 0);
    exports.export("bytes", ExportKind::Global, 1);
    module.section(&exports);
    let mut code = CodeSection::new();
    let mut entry = Function::new([]);
    for instruction in [
        Instruction::GlobalGet(0),
        Instruction::I32Const(1),
        Instruction::I32Add,
        Instruction::GlobalSet(0),
        Instruction::GlobalGet(1),
        Instruction::LocalGet(0),
        Instruction::I64ExtendI32U,
        Instruction::I64Add,
        Instruction::GlobalSet(1),
        Instruction::End,
    ] {
        entry.instruction(&instruction);
    }
    code.function(&entry);
    let mut payload = Function::new([]);
    for instruction in [
        Instruction::GlobalGet(1),
        Instruction::LocalGet(0),
        Instruction::I64Add,
        Instruction::GlobalSet(1),
        Instruction::End,
    ] {
        payload.instruction(&instruction);
    }
    code.function(&payload);
    let mut input = Function::new([]);
    input.instruction(&Instruction::End);
    code.function(&input);
    module.section(&code);
    let original = module.finish();
    let instrumented = instrument_with(
        &original,
        &[
            ("input", 0, &[(0, 1, false)], &[0, 0]),
            ("optional", 0, &[(0, 1, true)], &[0, 0]),
        ],
    )
    .expect("valid string descriptors");
    let mut child = Command::new("bun")
        .arg(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/examples/instrument_exports/bytes.ts"
        ))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("Bun");
    child
        .stdin
        .take()
        .expect("stdin")
        .write_all(&instrumented)
        .expect("write module");
    let output = child.wait_with_output().expect("Bun execution");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        String::from_utf8(output.stdout).expect("JSON"),
        "{\"result\":[6,8,12,16,18,18,18,24],\"counter\":9,\"bytes\":24,\"distinct\":true,\"trapped\":true}"
    );
    assert!(matches!(
        instrument_with(&original, &[("input", 0, &[(0, 1, false)], &[0, 1])]),
        Err(Error::Invalid(
            "generated export input does not match the WASM signature"
        ))
    ));
    assert!(matches!(
        instrument_with(&original, &[("input", 0, &[(0, 9, false)], &[0, 0])]),
        Err(Error::Invalid(
            "generated export input does not match the WASM signature"
        ))
    ));
    assert!(matches!(
        instrument_with(&original, &[("missing", 0, &[], &[])]),
        Err(Error::Invalid(
            "generated export input is absent from the WASM artifact"
        ))
    ));
    assert!(matches!(
        instrument_with(&original, &[("input", 0, &[(0, 1, false)], &[0, 0])]),
        Err(Error::UnsupportedExport(name)) if name == "optional"
    ));
}
