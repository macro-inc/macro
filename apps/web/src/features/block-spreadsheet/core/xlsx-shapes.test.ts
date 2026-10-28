import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  type SheetDrawing,
  validDrawings,
} from '@macro-inc/spreadsheet/sheet-drawings';
import { strFromU8, unzipSync } from 'fflate';
import { SaxesParser } from 'saxes';
import { describe, expect, it } from 'vitest';
import { presetOutline } from './shape-geometry';
import { decodeXlsx, encodeXlsx } from './xlsx-codec';
import { parse } from './xlsx-parts';
import {
  elementBuilder,
  readShape,
  shapeSource,
  shapeXml,
  type XmlElement,
} from './xlsx-shapes';

const fixture = () =>
  new Uint8Array(
    readFileSync(
      createRequire(import.meta.url).resolve('./xlsx-fixtures/shapes.xlsx')
    )
  );

const NAMESPACES =
  'xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"';

/** An element parsed as the drawing reader keeps it. */
function element(xml: string): XmlElement {
  const builder = elementBuilder();
  let root: XmlElement | undefined;
  parse(new TextEncoder().encode(xml), 'shape.xml', (parser) => {
    parser.on('opentag', (node) => builder.start(node));
    parser.on('text', (chunk) => builder.text(chunk));
    parser.on('closetag', () => {
      root = builder.end() ?? root;
    });
  });
  if (!root) throw new Error('No element');
  return root;
}

const wellFormed = (xml: string) => {
  const parser = new SaxesParser({ xmlns: true });
  parser.write(xml).close();
  return true;
};

const shapesOf = (drawings: SheetDrawing[]) =>
  drawings.flatMap((drawing) =>
    drawing.type === 'shape' ? [{ ...drawing, shape: drawing.shape }] : []
  );

describe('Excel shapes', () => {
  it('reads text boxes, styled shapes, lines, groups, linked text and SmartArt', async () => {
    const imported = await decodeXlsx(fixture());
    expect(imported.warnings).toEqual([]);
    const drawings = imported.sheets[0].metadata?.drawings ?? [];
    expect(validDrawings(drawings)).toBe(true);
    const [notes, button, total, pointer, flow, process] = shapesOf(drawings);
    expect(notes).toMatchObject({
      name: 'Notes',
      from: { row: 1, column: 4, x: 0, y: 0 },
      to: { row: 6, column: 8, x: 0, y: 0 },
    });
    expect(notes.shape.parts).toEqual([
      {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        fill: '#FFF2CC',
        line: { color: '#BF9000', width: 1.33 },
        text: {
          paragraphs: [
            {
              runs: [
                {
                  text: 'Quarterly notes',
                  size: 14,
                  bold: true,
                  color: '#7F6000',
                },
              ],
            },
            {
              runs: [
                { text: 'Revenue grew ', size: 11 },
                { text: 'every', size: 11, italic: true },
                { text: ' month.\n', size: 11 },
                { text: 'See the chart.', size: 11, underline: true },
              ],
            },
          ],
          insets: [10, 5, 10, 5],
          clip: true,
        },
      },
    ]);
    // Excel's default shape takes its fill, line and text from its style.
    // The fixture has Office 2007's theme.
    expect(button.shape.parts[0]).toMatchObject({
      geometry: 'roundRect',
      fill: '#4F81BD',
      line: { color: '#28415F', width: 1.33 },
      text: {
        anchor: 'middle',
        paragraphs: [
          {
            align: 'center',
            runs: [{ text: 'Total', size: 11, color: '#FFFFFF' }],
          },
        ],
      },
    });
    // Text linked to a cell keeps the value Excel last showed.
    expect(total.shape.parts[0].text).toMatchObject({
      link: '$B$5',
      paragraphs: [{ runs: [{ text: '4,200', bold: true, size: 12 }] }],
    });
    expect(pointer.shape.parts).toEqual([
      {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        geometry: 'straightConnector1',
        flipV: true,
        line: { color: '#C00000', width: 2, tail: 'triangle' },
      },
    ]);
    // A group's members are placed in its own coordinates, scaled to it.
    expect(
      flow.shape.parts.map(
        ({ x, y, width, height, geometry, fill, adjust }) => ({
          x,
          y,
          width,
          height,
          geometry,
          fill,
          adjust,
        })
      )
    ).toEqual([
      {
        x: 0,
        y: 0,
        width: 0.375,
        height: 1,
        geometry: undefined,
        fill: '#C0504D',
        adjust: undefined,
      },
      {
        x: 0.625,
        y: 0,
        width: 0.375,
        height: 1,
        geometry: 'chevron',
        fill: '#F79646',
        adjust: { adj: 30_000 },
      },
    ]);
    // SmartArt is its drawing: each box, then its text where Excel put it.
    expect(process.name).toBe('Process');
    expect(process.shape.parts).toHaveLength(6);
    expect(process.shape.parts[0]).toMatchObject({
      x: 0,
      geometry: 'roundRect',
      fill: '#4F81BD',
      line: { color: '#FFFFFF' },
    });
    expect(process.shape.parts[1]).toMatchObject({
      x: round(33_480 / 3_657_600),
      text: { paragraphs: [{ runs: [{ text: 'Plan', color: '#FFFFFF' }] }] },
    });
    expect(process.shape.source).toMatch(/^<xdr:grpSp /);
    expect(process.shape.source).not.toContain('dsp:');
    expect(process.shape.source).not.toContain('txXfrm');
  });

  it('keeps each shape for export, and writes it where it is now', async () => {
    const imported = await decodeXlsx(fixture());
    const sheet = imported.sheets[0];
    const drawings = (sheet.metadata?.drawings ?? []).map((drawing) =>
      drawing.name === 'Total button'
        ? {
            ...drawing,
            from: { ...drawing.from, row: 11 },
            to: { ...drawing.to!, row: 13 },
          }
        : drawing
    );
    const exported = await encodeXlsx({
      ...imported,
      sheets: [{ ...sheet, metadata: { ...sheet.metadata, drawings } }],
    });
    const files = unzipSync(exported.bytes);
    const part = strFromU8(files['xl/drawings/drawing1.xml']);
    expect(wellFormed(part)).toBe(true);
    // Shape ids are unique across the part, a group's members included.
    const ids = [...part.matchAll(/<xdr:cNvPr id="(\d+)"/g)].map(
      (match) => match[1]
    );
    expect(new Set(ids).size).toBe(ids.length);
    // The moved button's frame is where its anchor now is: row 12 is
    // 11 rows of 20 pixels down.
    expect(part).toMatch(
      /name="Total button"[\s\S]*?<a:off x="2438400" y="2095500"\/><a:ext cx="1219200" cy="381000"\/>/
    );
    expect(part).toContain('textlink="$B$5"');
    expect(part).toContain('<a:tailEnd type="triangle"/>');
    expect(files['xl/media/image1.emf']).toBeDefined();
    expect(strFromU8(files['[Content_Types].xml'])).toContain(
      '<Default Extension="emf" ContentType="image/x-emf"/>'
    );
    // The download reads back as the same shapes, in the same colors
    // whatever its theme. SmartArt comes back as a group of its shapes,
    // with each text on its box.
    const again = await decodeXlsx(exported.bytes);
    const parts = (drawings: SheetDrawing[]) =>
      shapesOf(drawings)
        .filter((drawing) => drawing.name !== 'Process')
        .map((drawing) => drawing.shape.parts);
    expect(parts(again.sheets[0].metadata?.drawings ?? [])).toEqual(
      parts(drawings)
    );
    const process = shapesOf(again.sheets[0].metadata?.drawings ?? []).find(
      (drawing) => drawing.name === 'Process'
    );
    expect(
      process?.shape.parts.map((part) => [
        part.fill,
        part.text?.paragraphs[0].runs[0].text,
      ])
    ).toEqual([
      ['#4F81BD', 'Plan'],
      ['#4F81BD', 'Build'],
      ['#4F81BD', 'Launch'],
    ]);
  });
});

const round = (value: number) => Math.round(value * 10_000) / 10_000;

describe('shape parts', () => {
  it('reads custom outlines, theme text and newer content as its fallback', () => {
    const shape = readShape(
      element(
        `<xdr:sp ${NAMESPACES} macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="2" name="Freeform"><a:hlinkClick r:id="rId9"/></xdr:cNvPr><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm rot="5400000"><a:off x="0" y="0"/><a:ext cx="200" cy="100"/></a:xfrm><a:custGeom><a:pathLst><a:path w="200" h="100"><a:moveTo><a:pt x="0" y="100"/></a:moveTo><a:lnTo><a:pt x="100" y="0"/></a:lnTo><a:arcTo wR="50" hR="50" stAng="10800000" swAng="10800000"/><a:close/></a:path></a:pathLst></a:custGeom><a:solidFill><a:schemeClr val="accent1"><a:alpha val="50000"/></a:schemeClr></a:solidFill><a:ln w="9525"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:prstDash val="sysDot"/></a:ln></xdr:spPr><xdr:txBody><a:bodyPr wrap="none" vert="vert270"/><a:lstStyle><a:lvl1pPr><a:defRPr sz="900"/></a:lvl1pPr></a:lstStyle><a:p><mc:AlternateContent><mc:Choice Requires="a14"><a:r><a:t>new</a:t></a:r></mc:Choice><mc:Fallback><a:r><a:t>old</a:t></a:r></mc:Fallback></mc:AlternateContent></a:p></xdr:txBody></xdr:sp>`
      ),
      []
    );
    expect(shape?.parts[0]).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      geometry: 'custom',
      paths: [
        {
          // The arc's half circle over the top, as curves from (100, 0)
          // through (150, -50) to (200, 0).
          d: 'M0,1L0.5,0C0.5,-0.2761 0.6119,-0.5 0.75,-0.5C0.8881,-0.5 1,-0.2761 1,0Z',
        },
      ],
      rotation: 90,
      fill: '#4472C4',
      opacity: 0.5,
      // The theme's text color follows the app's theme.
      line: { width: 1, dash: 'dot' },
      text: {
        paragraphs: [{ runs: [{ text: 'old', size: 9 }] }],
        insets: [10, 5, 10, 5],
        noWrap: true,
        vertical: 'up',
      },
    });
  });

  it('writes a stand-alone element, without links to parts the download lacks', () => {
    const source = shapeSource(
      element(
        `<xdr:sp ${NAMESPACES}><xdr:nvSpPr><xdr:cNvPr id="2" name="Link &amp; more"><a:hlinkClick r:id="rId9"/></xdr:cNvPr><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="10" y="20"/><a:ext cx="30" cy="40"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:blipFill><a:blip r:embed="rId3"/><a:stretch/></a:blipFill><a:ln><a:solidFill><a:schemeClr val="accent2"><a:lumMod val="75000"/></a:schemeClr></a:solidFill></a:ln><a:extLst><a:ext uri="{X}"><a14:hiddenFill><a:noFill/></a14:hiddenFill></a:ext></a:extLst></xdr:spPr><xdr:style><a:fontRef idx="minor"><a:schemeClr val="tx1"/></a:fontRef></xdr:style></xdr:sp>`
      ),
      []
    )!;
    expect(wellFormed(source)).toBe(true);
    expect(source).toContain('name="Link &amp; more"');
    expect(source).not.toContain('hlinkClick');
    expect(source).not.toContain('r:embed');
    expect(source).toContain('<a14:hiddenFill>');
    // Theme colors are kept as the colors they were, but the text color.
    expect(source).toContain(
      '<a:srgbClr val="ED7D31"><a:lumMod val="75000"/></a:srgbClr>'
    );
    expect(source).toContain('<a:schemeClr val="tx1"/>');
    // Placed in a drawing part with new ids and frame.
    let id = 40;
    const placed = shapeXml(
      { parts: [{ x: 0, y: 0, width: 1, height: 1 }], source },
      { x: 9525, y: 19_050, width: 95_250, height: 47_625 },
      () => id++
    );
    expect(placed).toContain('<xdr:cNvPr id="40"');
    expect(placed).toContain(
      '<a:xfrm><a:off x="9525" y="19050"/><a:ext cx="95250" cy="47625"/></a:xfrm>'
    );
  });

  it('writes shapes it has no Excel element for', () => {
    let id = 2;
    const xml = shapeXml(
      {
        parts: [
          {
            x: 0,
            y: 0,
            width: 0.5,
            height: 1,
            geometry: 'roundRect',
            adjust: { adj: 10_000 },
            fill: '#FF0000',
            text: {
              paragraphs: [
                {
                  align: 'center',
                  runs: [{ text: 'A & B\nnext', bold: true }],
                },
              ],
              link: "'My sheet'!$A$1",
            },
          },
          {
            x: 0.5,
            y: 0.5,
            width: 0.5,
            height: 0,
            geometry: 'straightConnector1',
            line: { width: 2, tail: 'arrow', dash: 'longDash' },
          },
        ],
      },
      { x: 0, y: 0, width: 1000, height: 500 },
      () => id++,
      'Group'
    );
    expect(wellFormed(`<root ${NAMESPACES}>${xml}</root>`)).toBe(true);
    expect(xml).toContain('<xdr:grpSp>');
    expect(xml).toContain('<a:gd name="adj" fmla="val 10000"/>');
    expect(xml).toContain(`textlink="'My sheet'!$A$1"`);
    expect(xml).toContain('<a:t>A &amp; B</a:t></a:r><a:br>');
    expect(xml).toContain('<xdr:cxnSp macro="">');
    expect(xml).toContain(
      '<a:prstDash val="lgDash"/><a:tailEnd type="arrow"/>'
    );
    const shape = readShape(
      element(`<root ${NAMESPACES}>${xml}</root>`).children[0] as XmlElement,
      []
    );
    expect(shape?.parts[1]).toMatchObject({
      x: 0.5,
      y: 0.5,
      width: 0.5,
      height: 0,
    });
  });
});

describe('preset outlines', () => {
  it('draws presets from their adjustments, and others as their box', () => {
    expect(presetOutline('rect', 100, 50).d).toBe('M0,0L100,0L100,50L0,50Z');
    expect(presetOutline('starburstUnknown', 100, 50).d).toBe(
      presetOutline(undefined, 100, 50).d
    );
    // A rounded corner of a sixth of the shorter side by default.
    expect(presetOutline('roundRect', 120, 60).d).toMatch(/^M10\.0002,0/);
    expect(presetOutline('rightArrow', 100, 50).d).toBe(
      'M0,12.5L75,12.5L75,0L100,25L75,50L75,37.5L0,37.5Z'
    );
    const line = presetOutline('straightConnector1', 100, 50);
    expect(line).toMatchObject({
      open: true,
      start: { x: 0, y: 0 },
      end: { x: 100, y: 50, angle: Math.atan2(50, 100) },
    });
    // Unknown arrows point the same way.
    expect(presetOutline('curvedRightArrow', 100, 50).d).toBe(
      presetOutline('rightArrow', 100, 50).d
    );
    expect(presetOutline('donut', 100, 100).evenOdd).toBe(true);
  });
});
