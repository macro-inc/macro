//! Redirect exports only; internal model calls retain their original indices.
use std::{borrow::Cow, collections::BTreeMap, convert::Infallible};
use wasm_encoder::{
    CodeSection, CustomSection, ExportSection, Function, FunctionSection, Instruction, Module,
    reencode::{self, Reencode},
};
use wasmparser::{ExternalKind, Parser, Payload, TypeRef, Validator};

const HELPER: &str = "__lexical_record_export_entry";
const MARKER: &str = "lexical-export-counters";

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
}

struct Instrument {
    helper: u32,
    exports: BTreeMap<String, u32>,
    wrappers: Vec<Wrapper>,
}

pub fn instrument(input: &[u8]) -> Result<Vec<u8>, Error> {
    Validator::new().validate_all(input)?;
    let mut types = Vec::new();
    let mut functions = Vec::new();
    let mut exports = Vec::new();
    let mut imports = 0;
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
                    if let TypeRef::Func(index) | TypeRef::FuncExact(index) = entry?.ty {
                        functions.push(index);
                        imports += 1;
                    }
                }
            }
            Payload::FunctionSection(section) => {
                functions.extend(section.into_iter().collect::<Result<Vec<_>, _>>()?);
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
        exports: BTreeMap::new(),
        wrappers: Vec::new(),
    };
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
        let incoming_bytes = if export.name.starts_with("__wbg_") && export.name.ends_with("_free")
        {
            4
        } else {
            0
        };
        let index = if let Some(index) = wrapped.get(&(export.index, incoming_bytes)) {
            *index
        } else {
            let type_index = functions[export.index as usize];
            let signature = &types[type_index as usize];
            if incoming_bytes != 0
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
            });
            wrapped.insert((export.index, incoming_bytes), index);
            index
        };
        reencoder.exports.insert(export.name.to_owned(), index);
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
            let mut function = Function::new([]);
            function.instruction(&Instruction::I32Const(wrapper.incoming_bytes));
            function.instruction(&Instruction::Call(self.helper));
            for parameter in 0..wrapper.parameters {
                function.instruction(&Instruction::LocalGet(parameter));
            }
            function.instruction(&Instruction::Call(wrapper.original));
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
