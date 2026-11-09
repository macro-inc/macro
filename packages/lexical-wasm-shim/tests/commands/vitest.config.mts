import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {defineConfig} from 'vitest/config';
const upstream=process.env.LEXICAL_UPSTREAM_SOURCE;
if(!upstream)throw new Error('Set LEXICAL_UPSTREAM_SOURCE to immutable upstream0.45 source');
const proof=JSON.parse(readFileSync(new URL('../../src/commands-source.json',import.meta.url),'utf8'));
for(const [name,hash] of Object.entries(proof.sources))if(createHash('sha256').update(readFileSync(resolve(upstream,'packages/lexical/src',name))).digest('hex')!==hash)throw new Error('Pinned upstream source changed: '+name);
export default defineConfig({
 cacheDir:resolve(process.env.TMPDIR??'/tmp','compat-core-commands-vite'),
 resolve:{alias:[{find:'@pinned-core/commands',replacement:resolve(upstream,'packages/lexical/src/LexicalCommands.ts')},{find:'@pinned-core/constants',replacement:resolve(upstream,'packages/lexical/src/LexicalConstants.ts')},{find:'@pinned-core/tags',replacement:resolve(upstream,'packages/lexical/src/LexicalUpdateTags.ts')}]},
 test:{include:[resolve(import.meta.dirname,'commands.test.ts')],environment:'node',maxWorkers:1},
});
