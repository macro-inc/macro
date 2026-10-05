import ExcelJS from 'exceljs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { decodeXlsx, encodeXlsx } from './xlsx-codec';

async function bytes(workbook: ExcelJS.Workbook) {
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function source() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Tasks');
  sheet.getCell('A1').value = 'Status';
  sheet.getCell('A2').value = 'Open';
  sheet.getCell('B2').value = 15;
  sheet.getCell('B3').value = 3;
  sheet.getCell('A1').note = 'Pick a status from the list.';
  sheet.getCell('A2').dataValidation = {
    type: 'list',
    allowBlank: true,
    formulae: ['"Open,Done,Blocked"'],
    showErrorMessage: true,
    errorTitle: 'Status',
    error: 'Choose a status from the list.',
  };
  sheet.getCell('B2').dataValidation = {
    type: 'whole',
    operator: 'between',
    formulae: [1, 100],
    showInputMessage: true,
    prompt: 'A whole number from 1 to 100',
  };
  sheet.addConditionalFormatting({
    ref: 'B2:B9',
    rules: [
      {
        type: 'cellIs',
        operator: 'greaterThan',
        formulae: [10],
        priority: 1,
        style: {
          font: { bold: true, color: { argb: 'FF9C0006' } },
          fill: {
            type: 'pattern',
            pattern: 'solid',
            bgColor: { argb: 'FFFFC7CE' },
          },
        },
      },
      {
        type: 'colorScale',
        priority: 2,
        cfvo: [{ type: 'min' }, { type: 'max' }],
        color: [{ argb: 'FFF8696B' }, { argb: 'FF63BE7B' }],
      },
    ],
  });
  sheet.addConditionalFormatting({
    ref: 'A2:A9',
    rules: [
      {
        type: 'expression',
        formulae: ['$A2="Done"'],
        priority: 1,
        style: { font: { strike: true } },
      },
      // ExcelJS writes only the formula of a text rule.
      {
        type: 'containsText',
        operator: 'containsText',
        text: 'Blocked',
        priority: 2,
        style: { font: { italic: true } },
      },
    ],
  });
  return workbook;
}

describe('Excel notes, data validation and conditional formatting', () => {
  it('imports them into sheet metadata', async () => {
    const { sheets } = await decodeXlsx(await bytes(source()));
    const metadata = sheets[0].metadata!;
    expect(metadata.notes).toEqual({ A1: 'Pick a status from the list.' });
    expect(metadata.validations).toEqual([
      {
        range: 'A2',
        type: 'list',
        formulas: ['"Open,Done,Blocked"'],
        allowBlank: true,
        showError: true,
        errorTitle: 'Status',
        error: 'Choose a status from the list.',
      },
      {
        range: 'B2',
        type: 'whole',
        operator: 'between',
        formulas: ['1', '100'],
        showPrompt: true,
        prompt: 'A whole number from 1 to 100',
      },
    ]);
    expect(metadata.conditionalFormats).toEqual([
      {
        range: 'B2:B9',
        type: 'cellIs',
        operator: 'greaterThan',
        formulas: ['10'],
        style: { bold: true, textColor: '#9C0006', fillColor: '#FFC7CE' },
      },
      {
        range: 'A2:A9',
        type: 'expression',
        formulas: ['$A2="Done"'],
        style: { strikethrough: true },
      },
      {
        range: 'B2:B9',
        type: 'colorScale',
        thresholds: [{ type: 'min' }, { type: 'max' }],
        colors: ['#F8696B', '#63BE7B'],
      },
      {
        range: 'A2:A9',
        type: 'expression',
        formulas: ['NOT(ISERROR(SEARCH("Blocked",A2)))'],
        style: { italic: true },
      },
    ]);
  });

  it('reads Excel 2010 formula rules with inline formats', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Plan').getCell('A1').value = 1;
    workbook.addWorksheet('Inputs').getCell('A1').value = 'Yes';
    const entries = unzipSync(await bytes(workbook));
    const path = 'xl/worksheets/sheet1.xml';
    entries[path] = strToU8(
      strFromU8(entries[path]).replace(
        '</worksheet>',
        '<extLst><ext uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:conditionalFormattings><x14:conditionalFormatting xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"><x14:cfRule type="expression" priority="1" id="{1}"><xm:f>Inputs!$A$1="Yes"</xm:f><x14:dxf><font><b/><color rgb="FF9C0006"/></font><numFmt numFmtId="164" formatCode="0.0"/><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></x14:dxf></x14:cfRule><x14:cfRule type="dataBar" id="{2}"><x14:dataBar minLength="0" maxLength="100"><x14:cfvo type="autoMin"/><x14:cfvo type="autoMax"/></x14:dataBar></x14:cfRule><xm:sqref>A1:B2</xm:sqref></x14:conditionalFormatting></x14:conditionalFormattings></ext></extLst></worksheet>'
      )
    );
    const { sheets, warnings } = await decodeXlsx(zipSync(entries));
    expect(warnings.join(' ')).not.toContain('rules');
    expect(sheets[0].metadata?.conditionalFormats).toEqual([
      {
        range: 'A1:B2',
        type: 'expression',
        formulas: ['Inputs!$A$1="Yes"'],
        style: {
          bold: true,
          textColor: '#9C0006',
          fillColor: '#FFC7CE',
          numberFormat: '0.0',
        },
      },
    ]);
  });

  it('exports them so that Excel readers and Macro read them back', async () => {
    const imported = await decodeXlsx(await bytes(source()));
    const exported = await encodeXlsx(imported);
    expect((await decodeXlsx(exported.bytes)).sheets[0].metadata).toEqual(
      imported.sheets[0].metadata
    );
    const files = unzipSync(exported.bytes);
    expect(strFromU8(files['[Content_Types].xml'])).toContain(
      '/xl/comments1.xml'
    );
    expect(strFromU8(files['xl/styles.xml'])).toContain(
      '<dxfs count="3"><dxf><font><b/><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf>'
    );
    const reader = new ExcelJS.Workbook();
    await reader.xlsx.load(exported.bytes.slice().buffer);
    const sheet = reader.getWorksheet('Tasks')!;
    expect(sheet.getCell('A1').note).toBe('Pick a status from the list.');
    expect(sheet.getCell('A2').dataValidation).toMatchObject({
      type: 'list',
      formulae: ['"Open,Done,Blocked"'],
    });
    expect(sheet.getCell('B2').dataValidation).toMatchObject({
      type: 'whole',
      operator: 'between',
    });
    const rules = (
      sheet as unknown as {
        conditionalFormattings: { ref: string; rules: { type: string }[] }[];
      }
    ).conditionalFormattings;
    expect(rules.map((entry) => [entry.ref, entry.rules[0].type])).toEqual([
      ['B2:B9', 'cellIs'],
      ['A2:A9', 'expression'],
      ['B2:B9', 'colorScale'],
      ['A2:A9', 'expression'],
    ]);
  });
});
