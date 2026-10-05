use std::vec::Vec;

use crate::{expressions::parser::DefinedNameS, types::*};

impl Workbook {
    pub fn get_worksheet_names(&self) -> Vec<String> {
        self.worksheets
            .iter()
            .map(|worksheet| worksheet.get_name())
            .collect()
    }
    pub fn get_worksheet_ids(&self) -> Vec<u32> {
        self.worksheets
            .iter()
            .map(|worksheet| worksheet.get_sheet_id())
            .collect()
    }

    pub fn worksheet(&self, worksheet_index: u32) -> Result<&Worksheet, String> {
        self.worksheets
            .get(worksheet_index as usize)
            .ok_or_else(|| "Invalid sheet index".to_string())
    }

    pub fn worksheet_mut(&mut self, worksheet_index: u32) -> Result<&mut Worksheet, String> {
        self.worksheets
            .get_mut(worksheet_index as usize)
            .ok_or_else(|| "Invalid sheet index".to_string())
    }

    /// Returns the a list of defined names in the workbook with their scope
    pub fn get_defined_names_with_scope(&self) -> Vec<DefinedNameS> {
        let sheet_id_index: Vec<u32> = self.worksheets.iter().map(|s| s.sheet_id).collect();

        let defined_names = self
            .defined_names
            .iter()
            .map(|dn| {
                let index = dn
                    .sheet_id
                    .and_then(|sheet_id| {
                        // returns an Option<usize>
                        sheet_id_index.iter().position(|&x| x == sheet_id)
                    })
                    // convert Option<usize> to Option<u32>
                    .map(|pos| pos as u32);

                (dn.name.clone(), index, dn.formula.clone())
            })
            .collect::<Vec<_>>();
        defined_names
    }
}
