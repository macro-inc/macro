//! Redirect exports only; internal model calls retain their original indices.
use std::{borrow::Cow, collections::BTreeMap, convert::Infallible};
use wasm_encoder::{
    BlockType, CodeSection, CustomSection, ExportSection, Function, FunctionSection, Instruction,
    MemArg, Module, ValType,
    reencode::{self, Reencode},
};
use wasmparser::{ExternalKind, Parser, Payload, TypeRef, Validator};

const HELPER: &str = "__lexical_record_export_entry";
const PAYLOAD: &str = "__lexical_record_payload_bytes";
const MARKER: &str = "lexical-export-counters";
type Input = (
    &'static str,
    u32,
    &'static [(u32, u32, bool)],
    &'static [u8],
);
include!(concat!(env!("OUT_DIR"), "/export_inputs.rs"));

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Parse(#[from] wasmparser::BinaryReaderError),
    #[error(transparent)]
    Encode(#[from] reencode::Error<Infallible>),
    #[error("{0}")]
    Invalid(&'static str),
}

struct Wrapper {
    original: u32,
    type_index: u32,
    parameters: u32,
    incoming_bytes: i32,
    strings: Vec<(u32, u32, bool)>,
    entry: bool,
}

struct Instrument {
    helper: u32,
    payload: Option<u32>,
    exports: BTreeMap<String, u32>,
    wrappers: Vec<Wrapper>,
    throw_imports: BTreeMap<u32, u32>,
}

pub fn instrument(input: &[u8]) -> Result<Vec<u8>, Error> {
    instrument_with(input, EXPORT_INPUTS)
}

fn instrument_with(input: &[u8], inputs: &[Input]) -> Result<Vec<u8>, Error> {
    Validator::new().validate_all(input)?;
    let mut types = Vec::new();
    let mut functions = Vec::new();
    let mut exports = Vec::new();
    let mut imports = 0;
    let mut memories = Vec::new();
    let mut throw_imports = Vec::new();
    for payload in Parser::new(0).parse_all(input) {
        match payload? {
            Payload::Version { encoding, .. } if encoding != wasmparser::Encoding::Module => {
                return Err(Error::Invalid("expected a core WASM module"));
            }
            Payload::TypeSection(section) => {
                types.extend(
                    section
                        .into_iter_err_on_gc_types()
                        .collect::<Result<Vec<_>, _>>()?,
                );
            }
            Payload::ImportSection(section) => {
                for entry in section.into_imports() {
                    let entry = entry?;
                    match entry.ty {
                        TypeRef::Func(index) | TypeRef::FuncExact(index) => {
                            if entry.name.starts_with("__wbg___wbindgen_throw_") {
                                throw_imports.push(imports);
                            }
                            functions.push(index);
                            imports += 1;
                        }
                        TypeRef::Memory(memory) => memories.push(memory),
                        _ => {}
                    }
                }
            }
            Payload::FunctionSection(section) => {
                functions.extend(section.into_iter().collect::<Result<Vec<_>, _>>()?);
            }
            Payload::MemorySection(section) => {
                memories.extend(section.into_iter().collect::<Result<Vec<_>, _>>()?);
            }
            Payload::ExportSection(section) => {
                exports.extend(section.into_iter().collect::<Result<Vec<_>, _>>()?);
            }
            Payload::CustomSection(section) if section.name() == MARKER => {
                return Err(Error::Invalid("export counters are already instrumented"));
            }
            _ => {}
        }
    }
    let helper = exports
        .iter()
        .find(|export| export.name == HELPER)
        .ok_or(Error::Invalid("missing export counter helper"))?;
    if !matches!(helper.kind, ExternalKind::Func | ExternalKind::FuncExact)
        || helper.index < imports
    {
        return Err(Error::Invalid(
            "export counter helper must be a defined function",
        ));
    }
    let helper_type = &types[functions[helper.index as usize] as usize];
    if helper_type.params() != [wasmparser::ValType::I32] || !helper_type.results().is_empty() {
        return Err(Error::Invalid(
            "export counter helper must have type (i32) -> ()",
        ));
    }
    let mut reencoder = Instrument {
        helper: helper.index,
        payload: None,
        exports: BTreeMap::new(),
        wrappers: Vec::new(),
        throw_imports: BTreeMap::new(),
    };
    if inputs.iter().any(|(_, _, strings, _)| !strings.is_empty()) || !throw_imports.is_empty() {
        if memories.len() != 1 || memories[0].memory64 || memories[0].shared {
            return Err(Error::Invalid(
                "string accounting requires one unshared memory32",
            ));
        }
        let payload = exports
            .iter()
            .find(|e| e.name == PAYLOAD)
            .ok_or(Error::Invalid("missing payload counter helper"))?;
        if !matches!(payload.kind, ExternalKind::Func | ExternalKind::FuncExact)
            || payload.index < imports
        {
            return Err(Error::Invalid(
                "payload counter helper must be a defined function",
            ));
        }
        let signature = &types[functions[payload.index as usize] as usize];
        if signature.params() != [wasmparser::ValType::I64] || !signature.results().is_empty() {
            return Err(Error::Invalid(
                "payload counter helper must have type (i64) -> ()",
            ));
        }
        reencoder.payload = Some(payload.index);
    }
    for (name, _, _, _) in inputs {
        if !exports.iter().any(|e| {
            e.name == *name && matches!(e.kind, ExternalKind::Func | ExternalKind::FuncExact)
        }) {
            return Err(Error::Invalid(
                "generated export input is absent from the WASM artifact",
            ));
        }
    }
    let count = u32::try_from(functions.len())
        .map_err(|_| Error::Invalid("too many functions for export instrumentation"))?;
    let mut wrapped = BTreeMap::new();
    for export in exports {
        if !matches!(export.kind, ExternalKind::Func | ExternalKind::FuncExact) {
            continue;
        }
        if export.name == HELPER {
            continue;
        }
        if export.index == reencoder.helper {
            return Err(Error::Invalid("export counter helper must have no aliases"));
        }
        // Generated class free exports take the receiver plus an ABI-only flag.
        // Pointer/length metadata of allocator exports carries no copied payload.
        let descriptor = inputs.iter().find(|(name, _, _, _)| *name == export.name);
        if !inputs.is_empty()
            && descriptor.is_none()
            && export.name != PAYLOAD
            && !matches!(
                export.name,
                "__wbindgen_malloc"
                    | "__wbindgen_realloc"
                    | "__wbindgen_free"
                    | "__wbindgen_start"
                    | "__externref_table_dealloc"
            )
            && !(export.name.starts_with("__wbg_") && export.name.ends_with("_free"))
        {
            return Err(Error::Invalid(
                "export has no generated input descriptor or supported glue policy",
            ));
        }
        let signature = &types[functions[export.index as usize] as usize];
        if let Some((_, _, strings, abi)) = descriptor
            && (abi.len() != signature.params().len()
                || abi
                    .iter()
                    .zip(signature.params())
                    .any(|(expected, actual)| match expected {
                        0 => *actual != wasmparser::ValType::I32,
                        1 => *actual != wasmparser::ValType::F64,
                        _ => true,
                    })
                || strings.iter().any(|(pointer, length, _)| {
                    *length != *pointer + 1
                        || *length as usize >= abi.len()
                        || abi[*pointer as usize] != 0
                        || abi[*length as usize] != 0
                }))
        {
            return Err(Error::Invalid(
                "generated export input does not match the WASM signature",
            ));
        }
        let incoming_bytes = if let Some((_, bytes, _, _)) = descriptor {
            i32::try_from(*bytes)
                .map_err(|_| Error::Invalid("fixed export input size exceeds i32"))?
        } else if export.name.starts_with("__wbg_") && export.name.ends_with("_free") {
            4
        } else {
            0
        };
        let strings = descriptor.map_or_else(Vec::new, |(_, _, strings, _)| strings.to_vec());
        let policy = (export.index, incoming_bytes, strings.clone());
        let index = if let Some(index) = wrapped.get(&policy) {
            *index
        } else {
            let type_index = functions[export.index as usize];
            if export.name.starts_with("__wbg_")
                && export.name.ends_with("_free")
                && (signature.params() != [wasmparser::ValType::I32, wasmparser::ValType::I32]
                    || !signature.results().is_empty())
            {
                return Err(Error::Invalid(
                    "class free export must have type (i32, i32) -> ()",
                ));
            }
            let index = count
                .checked_add(
                    u32::try_from(reencoder.wrappers.len())
                        .map_err(|_| Error::Invalid("too many export counter wrappers"))?,
                )
                .ok_or(Error::Invalid("too many export counter wrappers"))?;
            reencoder.wrappers.push(Wrapper {
                original: export.index,
                type_index,
                parameters: u32::try_from(signature.params().len())
                    .map_err(|_| Error::Invalid("too many exported function parameters"))?,
                incoming_bytes,
                strings,
                entry: true,
            });
            wrapped.insert(policy, index);
            index
        };
        reencoder.exports.insert(export.name.to_owned(), index);
    }
    for original in throw_imports {
        let type_index = functions[original as usize];
        let signature = &types[type_index as usize];
        if signature.params() != [wasmparser::ValType::I32, wasmparser::ValType::I32]
            || !signature.results().is_empty()
        {
            return Err(Error::Invalid("unexpected bindgen throw import signature"));
        }
        let index = count
            .checked_add(
                u32::try_from(reencoder.wrappers.len())
                    .map_err(|_| Error::Invalid("too many counter wrappers"))?,
            )
            .ok_or(Error::Invalid("too many counter wrappers"))?;
        reencoder.throw_imports.insert(original, index);
        reencoder.wrappers.push(Wrapper {
            original,
            type_index,
            parameters: 2,
            incoming_bytes: 0,
            strings: vec![(0, 1, false)],
            entry: false,
        });
    }
    let mut module = Module::new();
    reencoder.parse_core_module(&mut module, Parser::new(0), input)?;
    module.section(&CustomSection {
        name: Cow::Borrowed(MARKER),
        data: Cow::Borrowed(b"1"),
    });
    let output = module.finish();
    Validator::new().validate_all(&output)?;
    Ok(output)
}

impl Reencode for Instrument {
    type Error = Infallible;

    fn function_index(&mut self, function: u32) -> Result<u32, reencode::Error<Self::Error>> {
        Ok(self
            .throw_imports
            .get(&function)
            .copied()
            .unwrap_or(function))
    }

    fn parse_function_section(
        &mut self,
        functions: &mut FunctionSection,
        section: wasmparser::FunctionSectionReader<'_>,
    ) -> Result<(), reencode::Error<Self::Error>> {
        reencode::utils::parse_function_section(self, functions, section)?;
        for wrapper in &self.wrappers {
            functions.function(wrapper.type_index);
        }
        Ok(())
    }

    fn parse_code_section(
        &mut self,
        code: &mut CodeSection,
        section: wasmparser::CodeSectionReader<'_>,
    ) -> Result<(), reencode::Error<Self::Error>> {
        reencode::utils::parse_code_section(self, code, section)?;
        for wrapper in &self.wrappers {
            let locals = if wrapper.strings.is_empty() {
                vec![]
            } else {
                vec![(2, ValType::I32), (1, ValType::I64), (1, ValType::I32)]
            };
            let mut function = Function::new(locals);
            if wrapper.entry {
                function.instruction(&Instruction::I32Const(wrapper.incoming_bytes));
                function.instruction(&Instruction::Call(self.helper));
            }
            for &(pointer, length, optional) in &wrapper.strings {
                if optional {
                    function.instruction(&Instruction::LocalGet(pointer));
                    function.instruction(&Instruction::If(BlockType::Empty));
                }
                count_string(&mut function, wrapper.parameters, pointer, length);
                function.instruction(&Instruction::Call(
                    self.payload.expect("validated string counter"),
                ));
                if optional {
                    function.instruction(&Instruction::End);
                }
            }
            for parameter in 0..wrapper.parameters {
                function.instruction(&Instruction::LocalGet(parameter));
            }
            let original = if wrapper.entry {
                self.throw_imports
                    .get(&wrapper.original)
                    .copied()
                    .unwrap_or(wrapper.original)
            } else {
                wrapper.original
            };
            function.instruction(&Instruction::Call(original));
            function.instruction(&Instruction::End);
            code.function(&function);
        }
        Ok(())
    }

    fn parse_export(
        &mut self,
        exports: &mut ExportSection,
        mut export: wasmparser::Export<'_>,
    ) -> Result<(), reencode::Error<Self::Error>> {
        if export.name == HELPER {
            // The helper records its own entry when called directly. Keeping it
            // unwrapped also preserves wasm-bindgen's generated raw ABI types.
            return reencode::utils::parse_export(self, exports, export);
        }
        if let Some(index) = self.exports.get(export.name) {
            export.index = *index;
        }
        reencode::utils::parse_export(self, exports, export)
    }
}

#[cfg(test)]
mod test;

// wasm-bindgen supplies UTF-8 strings. Count UTF-16 payload units without copying
// them out of memory; continuation bytes contribute no units. Empty optional
// strings need no memory load. Use i64 so a large memory32 string cannot overflow.
fn count_string(function: &mut Function, parameters: u32, pointer: u32, length: u32) {
    let cursor = parameters;
    let remaining = parameters + 1;
    let total = parameters + 2;
    let byte = parameters + 3;
    for instruction in [
        Instruction::LocalGet(pointer),
        Instruction::LocalSet(cursor),
        Instruction::LocalGet(length),
        Instruction::LocalSet(remaining),
        Instruction::I64Const(0),
        Instruction::LocalSet(total),
        Instruction::Block(BlockType::Empty),
        Instruction::Loop(BlockType::Empty),
        Instruction::LocalGet(remaining),
        Instruction::I32Eqz,
        Instruction::BrIf(1),
        Instruction::LocalGet(cursor),
        Instruction::I32Load8U(MemArg {
            offset: 0,
            align: 0,
            memory_index: 0,
        }),
        Instruction::LocalTee(byte),
        Instruction::I32Const(0xc0),
        Instruction::I32And,
        Instruction::I32Const(0x80),
        Instruction::I32Ne,
        Instruction::If(BlockType::Empty),
        Instruction::LocalGet(total),
        Instruction::LocalGet(byte),
        Instruction::I32Const(0xf0),
        Instruction::I32GeU,
        Instruction::If(BlockType::Result(ValType::I64)),
        Instruction::I64Const(4),
        Instruction::Else,
        Instruction::I64Const(2),
        Instruction::End,
        Instruction::I64Add,
        Instruction::LocalSet(total),
        Instruction::End,
        Instruction::LocalGet(cursor),
        Instruction::I32Const(1),
        Instruction::I32Add,
        Instruction::LocalSet(cursor),
        Instruction::LocalGet(remaining),
        Instruction::I32Const(1),
        Instruction::I32Sub,
        Instruction::LocalSet(remaining),
        Instruction::Br(0),
        Instruction::End,
        Instruction::End,
        Instruction::LocalGet(total),
    ] {
        function.instruction(&instruction);
    }
}
