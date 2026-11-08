import {
  BlockAliasRegistry,
  BlockRegistry,
} from '../src/lib/constants/block-registry';

const path = new URL(
  '../../../crates/client/lexical/macro_document_model/src/plugins_group_b/text_paste/app-blocks.json',
  import.meta.url
);
const text =
  JSON.stringify([...BlockRegistry, ...BlockAliasRegistry], null, 2) + '\n';
if (process.argv.includes('--check')) {
  if ((await Bun.file(path).text()) !== text)
    throw new Error('Stale text paste app block catalog');
} else await Bun.write(path, text);
