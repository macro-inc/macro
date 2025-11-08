import { toPlaintext, toSearchText } from '../src/lib/convsersions';

try {
  const path = Bun.resolveSync('../../test-files/01.json', import.meta.path);
  const file = Bun.file(path);
  const json = await file.json();
  const plaintext = toPlaintext(json);
  const searchText = toSearchText(json);
  console.log('\n----- snapShotToPlainText ----');
  console.log(plaintext);
  console.log('\n');
  console.log('\n----- snapShotToSeatchText -----');
  console.log(searchText);
} catch (error) {
  console.error('Conversion error:', error);
}
