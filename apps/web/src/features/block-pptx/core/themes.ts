/**
 * PowerPoint's built-in theme color sets and font pairs (Design ▸ Variants),
 * applied to a deck with `setThemeColors` and `setThemeFonts`.
 */

export interface ColorSet {
  name: string;
  /** dk1, lt1, dk2, lt2, accent1-6, hlink, folHlink as RRGGBB. */
  colors: Record<string, string>;
}

const set = (
  name: string,
  dk2: string,
  lt2: string,
  accents: [string, string, string, string, string, string],
  hlink: string,
  folHlink: string
): ColorSet => ({
  name,
  colors: {
    dk1: '000000',
    lt1: 'FFFFFF',
    dk2,
    lt2,
    ...Object.fromEntries(accents.map((c, i) => [`accent${i + 1}`, c])),
    hlink,
    folHlink,
  },
});

export const COLOR_SETS: ColorSet[] = [
  set(
    'Office',
    '0E2841',
    'E8E8E8',
    ['156082', 'E97132', '196B24', '0F9ED5', 'A02B93', '4EA72E'],
    '467886',
    '96607D'
  ),
  set(
    'Office 2013 - 2022',
    '44546A',
    'E7E6E6',
    ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'],
    '0563C1',
    '954F72'
  ),
  set(
    'Office 2007 - 2010',
    '1F497D',
    'EEECE1',
    ['4F81BD', 'C0504D', '9BBB59', '8064A2', '4BACC6', 'F79646'],
    '0000FF',
    '800080'
  ),
  set(
    'Grayscale',
    '000000',
    'F8F8F8',
    ['DDDDDD', 'B2B2B2', '969696', '808080', '5F5F5F', '4D4D4D'],
    '5F5F5F',
    '919191'
  ),
  set(
    'Blue Warm',
    '242852',
    'ACCBF9',
    ['4A66AC', '629DD1', '297FD5', '7F8FA9', '5AA2AE', '9D90A0'],
    '9454C3',
    '3EBBF0'
  ),
  set(
    'Blue',
    '17406D',
    'DBEFF9',
    ['0F6FC6', '009DD9', '0BD0D9', '10CF9B', '7CCA62', 'A5C249'],
    'F49100',
    '85DFD0'
  ),
  set(
    'Blue II',
    '335B74',
    'DFE3E5',
    ['1CADE4', '2683C6', '27CED7', '42BA97', '3E8853', '62A39F'],
    '6B9F25',
    'B26B02'
  ),
  set(
    'Blue Green',
    '373545',
    'CEDBE6',
    ['3494BA', '58B6C0', '75BDA7', '7A8C8E', '84ACB6', '2683C6'],
    '6B9F25',
    '9F6715'
  ),
  set(
    'Green',
    '455F51',
    'E3DED1',
    ['549E39', '8AB833', 'C0CF3A', '029676', '4AB5C4', '0989B1'],
    '6B9F25',
    'BA6906'
  ),
  set(
    'Green Yellow',
    '455F51',
    'E3DED1',
    ['99CB38', '63A537', '37A76F', '44C1A3', '4EB3CF', '51C3F9'],
    'EE7B08',
    '977B2D'
  ),
  set(
    'Yellow',
    '39302A',
    'E5DEDB',
    ['FFCA08', 'F8931D', 'CE8D3E', 'EC7016', 'E64823', '9C6A6A'],
    '2998E3',
    '7F723D'
  ),
  set(
    'Yellow Orange',
    '4E3B30',
    'FBEEC9',
    ['F0A22E', 'A5644E', 'B58B80', 'C3986D', 'A19574', 'C17529'],
    'AD1F1F',
    'FFC42F'
  ),
  set(
    'Orange',
    '637052',
    'CCDDEA',
    ['E48312', 'BD582C', '865640', '9B8357', 'C2BC80', '94A088'],
    '2998E3',
    '8C8C8C'
  ),
  set(
    'Orange Red',
    '696464',
    'E9E5DC',
    ['D34817', '9B2D1F', 'A28E6A', '956251', '918485', '855D5D'],
    'CC9900',
    '96A9A9'
  ),
  set(
    'Red Orange',
    '505046',
    'EEECE1',
    ['E84C22', 'FFBD47', 'B64926', 'FF8427', 'CC9900', 'B22600'],
    'CC9900',
    '666699'
  ),
  set(
    'Red',
    '323232',
    'E5C243',
    ['A5300F', 'D55816', 'E19825', 'B19C7D', '7F5F52', 'B27D49'],
    '6B9F25',
    'B26B02'
  ),
  set(
    'Red Violet',
    '454551',
    'D8D9DC',
    ['E32D91', 'C830CC', '4EA6DC', '4775E7', '8971E1', 'D54773'],
    '6B9F25',
    '8C8C8C'
  ),
  set(
    'Violet',
    '373545',
    'DCD8DC',
    ['AD84C6', '8784C7', '5D739A', '6997AF', '84ACB6', '6F8183'],
    '69A020',
    '8C8C8C'
  ),
  set(
    'Violet II',
    '632E62',
    'EAE5EB',
    ['92278F', '9B57D3', '755DD9', '665EB8', '45A5ED', '5982DB'],
    '0066FF',
    '666699'
  ),
  set(
    'Median',
    '775F55',
    'EBDDC3',
    ['94B6D2', 'DD8047', 'A5AB81', 'D8B25C', '7BA79D', '968C8C'],
    'F7B615',
    '704404'
  ),
  set(
    'Paper',
    '444D26',
    'FEFAC9',
    ['A5B592', 'F3A447', 'E7BC29', 'D092A7', '9C85C0', '809EC2'],
    '8E58B6',
    '7F6F6F'
  ),
  set(
    'Marquee',
    '5E5E5E',
    'DDDDDD',
    ['418AB3', 'A6B727', 'F69200', '838383', 'FEC306', 'DF5327'],
    'F59E00',
    'B2B2B2'
  ),
  set(
    'Slipstream',
    '212745',
    'B4DCFA',
    ['4E67C8', '5ECCF3', 'A7EA52', '5DCEAF', 'FF8021', 'F14124'],
    '56C7AA',
    '59A8D1'
  ),
  set(
    'Aspect',
    '323232',
    'E3DED1',
    ['F07F09', '9F2936', '1B587C', '4E8542', '604878', 'C19859'],
    '6B9F25',
    'B26B02'
  ),
];

export interface FontPair {
  name: string;
  major: string;
  minor: string;
}

export const FONT_PAIRS: FontPair[] = [
  { name: 'Office', major: 'Aptos Display', minor: 'Aptos' },
  { name: 'Office 2013 - 2022', major: 'Calibri Light', minor: 'Calibri' },
  { name: 'Office 2007 - 2010', major: 'Cambria', minor: 'Calibri' },
  { name: 'Calibri', major: 'Calibri', minor: 'Calibri' },
  { name: 'Arial', major: 'Arial', minor: 'Arial' },
  { name: 'Corbel', major: 'Corbel', minor: 'Corbel' },
  { name: 'Candara', major: 'Candara', minor: 'Candara' },
  {
    name: 'Franklin Gothic',
    major: 'Franklin Gothic Medium',
    minor: 'Franklin Gothic Book',
  },
  { name: 'Century Gothic', major: 'Century Gothic', minor: 'Century Gothic' },
  { name: 'Tahoma', major: 'Tahoma', minor: 'Tahoma' },
  { name: 'Segoe UI', major: 'Segoe UI', minor: 'Segoe UI' },
  { name: 'Trebuchet MS', major: 'Trebuchet MS', minor: 'Trebuchet MS' },
  { name: 'Verdana', major: 'Verdana', minor: 'Verdana' },
  { name: 'Georgia', major: 'Georgia', minor: 'Georgia' },
  { name: 'Garamond', major: 'Garamond', minor: 'Garamond' },
  { name: 'Cambria', major: 'Cambria', minor: 'Cambria' },
  {
    name: 'Times New Roman',
    major: 'Times New Roman',
    minor: 'Times New Roman',
  },
  { name: 'Gill Sans MT', major: 'Gill Sans MT', minor: 'Gill Sans MT' },
];
