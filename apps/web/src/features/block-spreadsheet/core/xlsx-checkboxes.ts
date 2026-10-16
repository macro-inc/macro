import { attributes, parse } from './xlsx-parts';

const FEATURE_PROPERTY_BAGS =
  'http://schemas.microsoft.com/office/spreadsheetml/2022/featurepropertybag';

export const CHECKBOX_PART = 'xl/featurePropertyBag/featurePropertyBag.xml';
export const CHECKBOX_CONTENT_TYPE =
  'application/vnd.ms-excel.featurepropertybag+xml';
export const CHECKBOX_RELATIONSHIP =
  'http://schemas.microsoft.com/office/2022/11/relationships/FeaturePropertyBag';

/** The bags Excel writes for its checkbox format, as `xfComplement` 0. */
export const CHECKBOX_BAGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<FeaturePropertyBags xmlns="${FEATURE_PROPERTY_BAGS}"><bag type="Checkbox"/><bag type="XFControls"><bagId k="CellControl">0</bagId></bag><bag type="XFComplement"><bagId k="XFControls">1</bagId></bag><bag type="XFComplements" extRef="XFComplementsMapperExtRef"><a k="MappedFeaturePropertyBags"><bagId>2</bagId></a></bag></FeaturePropertyBags>`;

/** What a cell format (`xf`) carries to be a checkbox. */
export const CHECKBOX_XF_EXTENSION = `<extLst><ext uri="{C7286773-470A-42A8-94C5-96B5CB345126}" xmlns:xfpb="${FEATURE_PROPERTY_BAGS}"><xfpb:xfComplement i="0"/></ext></extLst>`;

type Bag = { type: string; ids: Record<string, number>; mapped: number[] };

/**
 * The `xfComplement` indexes that are Excel's checkbox format. Each indexes
 * the XFComplements bag's mapped list, whose bag leads through XFControls to
 * a Checkbox bag; bags are numbered by position ([MS-XLSX] 2.3.9).
 */
export function readCheckboxComplements(
  bytes: Uint8Array,
  path: string
): Set<number> {
  const bags: Bag[] = [];
  let bag: Bag | undefined;
  let array: string | undefined;
  let key: string | undefined;
  let text = '';
  parse(bytes, path, (parser) => {
    parser.on('opentag', (node) => {
      const value = attributes(node);
      if (node.local === 'bag') {
        bag = { type: value.type ?? '', ids: {}, mapped: [] };
        bags.push(bag);
      } else if (node.local === 'a') array = value.k;
      else if (node.local === 'bagId') {
        key = value.k;
        text = '';
      }
    });
    parser.on('text', (value) => {
      text += value;
    });
    parser.on('closetag', (node) => {
      if (node.local === 'bagId' && bag) {
        const id = Number(text.trim());
        if (array === 'MappedFeaturePropertyBags') bag.mapped.push(id);
        else if (key) bag.ids[key] = id;
      } else if (node.local === 'a') array = undefined;
      else if (node.local === 'bag') bag = undefined;
    });
  });
  const linked = (from: Bag | undefined, key: string, type: string) => {
    const id = from?.ids[key];
    const target = id === undefined ? undefined : bags[id];
    return target?.type === type ? target : undefined;
  };
  const checkboxes = new Set<number>();
  const mapped =
    bags.find((entry) => entry.type === 'XFComplements')?.mapped ?? [];
  for (const [index, id] of mapped.entries()) {
    const complement = bags[id];
    if (complement?.type !== 'XFComplement') continue;
    const controls = linked(complement, 'XFControls', 'XFControls');
    if (linked(controls, 'CellControl', 'Checkbox')) checkboxes.add(index);
  }
  return checkboxes;
}
