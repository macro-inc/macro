// Node 24 oracle over the pinned upstream sources; no upstream code is changed.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const upstream=process.argv[2];
if(!upstream) throw new Error('usage: node record-regex.mjs /path/to/lexical');
const directory=path.join(upstream,'packages/lexical-markdown/src');
const context={};
function source(name){
  let text=stripTypeScriptTypes(fs.readFileSync(path.join(directory,name),'utf8'),{mode:'transform'});
  text=text.replace(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];?/g,(_,names)=>{
    for(const name of names.split(',').map(s=>s.trim()).filter(Boolean)){
      const key=name.split(/\s+as\s+/).at(-1);
      context[key]=()=>{throw new Error('unexpected upstream host call '+key);};
    }
    return '';
  }).replace(/export\s+(?=const|function)/g,'');
  return text;
}
const transformerSource=source('MarkdownTransformers.ts');
context.createState=()=>({});
const names=['ORDERED_LIST','UNORDERED_LIST','CHECK_LIST','HEADING','QUOTE','CODE_START','CODE_END','CODE_SINGLE_LINE','TABLE_ROW','TABLE_ROW_DIVIDER','TAG_START','TAG_END'];
const exports=names.map(name=>name+':'+name+(name.startsWith('TABLE_ROW')?'_REG_EXP':'_REGEX')).join(',');
const values=vm.runInNewContext(transformerSource+';({'+exports+',LINK_OBJECT:LINK})',context);
values.TAG_START_AT_END=new RegExp('(?:'+values.TAG_START.source+')$',values.TAG_START.flags);
values.TAG_END_AT_END=new RegExp('(?:'+values.TAG_END.source+')$',values.TAG_END.flags);
values.LINK_IMPORT=values.LINK_OBJECT.importRegExp;
values.LINK=values.LINK_OBJECT.regExp;
delete values.LINK_OBJECT;
const importSource=source('MarkdownImport.ts');
values.CODE_SPAN=vm.runInNewContext(importSource+';createTextFormatTransformersIndex([{tag:"`",format:["code"]}]).fullMatchRegExpByTag["`"]',context);
const listEscape=transformerSource.match(/childrenText\.replace\((\/.*\/), '\$1/)[1];
values.LIST_ESCAPE=vm.runInNewContext(listEscape);
const fixtureDirectory=path.resolve('packages/lexical-conformance/fixtures/upstream/lexical-markdown');
const snippets=new Set(['','ſ','K','İ','ı','ẞ','ςΣσ','ͅ','ﬀﬁﬂﬃﬄﬅﬆ','Ꭰꭰ','😀x','😀`code`','𐐀a','á','<ſpan>','<Kbd>','<span>','<my_tag x="y">','# heading','[a](https://example.com "title")','**bold `code` end**','a_b_c a*b*c **bold `code` end** ~~gone~~ ==hi==','\\*literal\\*','```js\n😀\n```','- list','  [X] check','7. item','| a |','| :-: |','a\r\nb','a\u2028b','\uFEFFx','\u0085x']);
function collect(value){if(typeof value==='string')snippets.add(value);else if(Array.isArray(value))value.forEach(collect);else if(value&&typeof value==='object')Object.values(value).forEach(collect);}
for(const file of fs.readdirSync(fixtureDirectory).sort()){
  const fixture=JSON.parse(fs.readFileSync(path.join(fixtureDirectory,file),'utf8'));
  for(const op of fixture.trace??[])if(op.op==='call'&&op.fn?.includes('Markdown'))collect(op.args);
}
const inputs=[...snippets];
const patterns=Object.entries(values).map(([name,re])=>({name,source:re.source.replaceAll('\\/','/'),flags:re.flags})).sort((a,b)=>a.name.localeCompare(b.name));
const ledger=[{reason:'lone-surrogate',inputUnits:[[0xd800],[0xdfff]],decision:'S3 §2.9 R-5: Rust input receives U+FFFD'}];
function matches(re,text){const regex=new RegExp(re.source,re.flags+'g');return [...text.matchAll(regex)].map(m=>({index:m.index,groups:[...m].map((v,group)=>{
  if(v===undefined)return null;
  if(v!==v.toWellFormed())ledger.push({reason:'lone-surrogate',pattern:re.name,text,index:m.index,group,units:Array.from({length:v.length},(_,i)=>v.charCodeAt(i)),decision:'S3 §2.9 R-5: capture decodes lone surrogates as U+FFFD'});
  return v.toWellFormed();
})}));}
const cases=patterns.flatMap(pattern=>inputs.map(text=>({name:pattern.name,text,matches:matches(pattern,text)})));
// Lone surrogate input cannot cross Rust's UTF-8 string boundary; keep its exclusion explicit.

// The same unmodified upstream delimiter selector supplements literal engine tests.
const formatContext={PUNCTUATION:/[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~]/,WHITESPACE:/\s/};
let formatSource=stripTypeScriptTypes(fs.readFileSync(path.join(directory,'importTextFormatTransformer.ts'),'utf8'),{mode:'transform'}).replace(/import\s*\{[^}]+\}\s*from[^;]+;/g,'').replace(/export /g,'');
const select=vm.runInNewContext(formatSource+';findOutermostTextFormatTransformer',formatContext);
const formatIndex={transformersByTag:Object.fromEntries(['`','***','___','**','__','==','*','_','~~'].map(tag=>[tag,{tag}])),fullMatchRegExpByTag:{'`':values.CODE_SPAN}};
const formats=inputs.map(text=>{const m=select({getTextContent:()=>text},formatIndex);return{text,match:m?{start:m.startIndex,end:m.endIndex,tag:m.match[1],content:m.match[2]}:null};});
const destination=new URL('./fixtures/regex-v8.json',import.meta.url);
fs.writeFileSync(destination,JSON.stringify({upstream:'0.45.0',node:process.versions.node,patterns,cases,formats,ledger},null,2)+'\n');
console.log(patterns.length+' patterns; '+inputs.length+' inputs; '+cases.length+' regex cases; '+ledger.length+' surrogate ledger entries');
