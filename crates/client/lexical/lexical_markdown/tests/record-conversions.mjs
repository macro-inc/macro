// Re-record the actual upstream table without deriving expected trees in Rust.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createRequire,stripTypeScriptTypes} from 'node:module';
const [upstream,oracle]=process.argv.slice(2);
if(!upstream||!oracle)throw new Error('usage: node record-conversions.mjs UPSTREAM ORACLE_DEPENDENCIES');
if(process.versions.node.split('.')[0]!=='24')throw new Error('requires Node 24');
const require=createRequire(path.resolve(oracle,'package.json'));
const {JSDOM}=require('jsdom');
const {window}=new JSDOM('<!doctype html><html><body></body></html>');
for(const key of ['window','document','DOMParser','Node','HTMLElement','Element','DocumentFragment','MutationObserver','getComputedStyle'])globalThis[key]=window[key];
for(const name of ['lexical','@lexical/markdown','@lexical/headless','@lexical/rich-text','@lexical/list','@lexical/link','@lexical/code-core','@lexical/html']){
 const pkg=JSON.parse(fs.readFileSync(path.join(oracle,'node_modules',name,'package.json'),'utf8'));
 if(pkg.version!=='0.45.0')throw new Error('requires pinned '+name+' 0.45.0');
}
const lexical=require('lexical');
const markdown=require('@lexical/markdown');
const rich=require('@lexical/rich-text');
const list=require('@lexical/list');
const code=require('@lexical/code-core');
const link=require('@lexical/link');
const html=require('@lexical/html');
const {createHeadlessEditor}=require('@lexical/headless');
const file=path.join(upstream,'packages/lexical-markdown/src/__tests__/unit/LexicalMarkdown.test.ts');
let source=stripTypeScriptTypes(fs.readFileSync(file,'utf8'),{mode:'transform'});
source=source.slice(0,source.indexOf("describe('Markdown',"));
source=source.replace(/import\s[\s\S]*?from\s*['"][^'"]+['"];?/g,'').replaceAll('export const','const');
const original=stripTypeScriptTypes(fs.readFileSync(file,'utf8'),{mode:'transform'});
const start=original.indexOf('const IMPORT_AND_EXPORT');
const end=original.indexOf('for (const {',start);
const tableSource=original.slice(start,end);
const names=['HIGHLIGHT_TEXT_MATCH_IMPORT','SIMPLE_INLINE_JSX_MATCHER','MDX_HTML_TRANSFORMER','CODE_TAG_COUNTER_EXAMPLE','CANCELED_HEADING_REPLACE_EXAMPLE'];
const context={...lexical,...markdown,...rich,...list,...code,...link};
const result=vm.runInNewContext(source+"\nconst URL='https://lexical.dev';\n"+tableSource+';({rows:IMPORT_AND_EXPORT,customs:{'+names.join(',')+'}})',context);
const customNames=new Map(Object.entries(result.customs).map(([k,v])=>[v,k]));
const rows=result.rows.map((row,index)=>{
 const customTransformers=row.customTransformers??[];
 const transformers=[...customTransformers,...markdown.TRANSFORMERS];
 const editor=()=>createHeadlessEditor({namespace:'oracle',nodes:[rich.HeadingNode,rich.QuoteNode,list.ListNode,list.ListItemNode,code.CodeNode,link.LinkNode],onError(error){throw error;}});
 const out={index,md:row.md,html:row.html,preserve:!!row.shouldPreserveNewLines,merge:!!row.shouldMergeAdjacentLines,custom:customTransformers.map(t=>customNames.get(t)??Object.entries(markdown).find(([,v])=>v===t)?.[0]),skipImport:!!row.skipImport,skipExport:!!row.skipExport};
 if(out.custom.some(v=>!v))throw new Error('unmapped custom transformer '+index);
 if(!row.skipImport){const e=editor();e.update(()=>markdown.$convertFromMarkdownString(row.md,[...transformers,result.customs.HIGHLIGHT_TEXT_MATCH_IMPORT],undefined,row.shouldPreserveNewLines,row.shouldMergeAdjacentLines),{discrete:true});out.imported=e.getEditorState().toJSON();const actualHtml=e.getEditorState().read(()=>html.$generateHtmlFromNodes(e),{editor:e});if(actualHtml!==row.html)throw new Error('upstream import HTML assertion failed at '+index);out.selection=e.getEditorState().read(()=>lexical.$getSelection());}
 if(!row.skipExport){const e=editor();e.update(()=>{const dom=new window.DOMParser().parseFromString(row.html,'text/html');const nodes=html.$generateNodesFromDOM(e,dom);lexical.$getRoot().select();lexical.$insertNodes(nodes);},{discrete:true});out.exportInput=e.getEditorState().toJSON();out.exported=e.getEditorState().read(()=>markdown.$convertToMarkdownString(transformers,undefined,row.shouldPreserveNewLines));if(out.exported!==(row.mdAfterExport??row.md))throw new Error('upstream export assertion failed at '+index+': '+JSON.stringify(out.exported));}
 return out;
});
const expanded=rows.reduce((n,r)=>n+(!r.skipImport?2:0)+(!r.skipExport?1:0),0);
if(rows.length!==111||expanded!==303)throw new Error('unexpected table inventory '+rows.length+'/'+expanded);
console.log({imports:rows.filter(r=>!r.skipImport).length,exports:rows.filter(r=>!r.skipExport).length,uniqueImports:new Set(rows.filter(r=>!r.skipImport).map(r=>r.md)).size,uniqueExports:new Set(rows.filter(r=>!r.skipExport).map(r=>r.md)).size});
const destination=new URL('./fixtures/conversions-v045.json',import.meta.url);
fs.writeFileSync(destination,JSON.stringify({upstream:'0.45.0',node:process.versions.node,source:path.relative(upstream,file),sourceSha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex'),expanded,rows},null,2)+'\n');
console.log(rows.length+' upstream rows; '+expanded+' expanded cases');
