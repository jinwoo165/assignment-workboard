import {unzipSync,strFromU8} from 'fflate';
import {XMLParser} from 'fast-xml-parser';
export const DOCUMENT_ACCEPT='.txt,.md,.csv,.eml,.json,.pdf,.docx,.pptx,.xlsx,.zip';
const MAX_FILE=20*1024*1024,MAX_TOTAL=50*1024*1024,MAX_TEXT=650000;
const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,processEntities:true});
const arr=x=>x==null?[]:Array.isArray(x)?x:[x];
function textNodes(x,key){if(!x||typeof x!=='object')return [];return Object.entries(x).flatMap(([k,v])=>k===key?arr(v).map(n=>typeof n==='object'?String(n['#text']||''):String(n)):arr(v).flatMap(n=>textNodes(n,key)));}
export function boundedUnzip(bytes){let total=0;return unzipSync(bytes,{filter:file=>{total+=file.originalSize;if(total>MAX_TOTAL||file.originalSize>MAX_FILE)throw Error('압축 해제 크기가 한도를 넘습니다. 파일을 나누어 주세요.');return !file.name.endsWith('/');}});}
function officeTextRaw(bytes,extension){
 const files=boundedUnzip(bytes),xml=name=>{if(!files[name])return null;const text=strFromU8(files[name]);if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('외부 엔터티 선언이 있는 문서는 읽지 않습니다.');return parser.parse(text);};
 if(extension==='docx'){const doc=xml('word/document.xml');if(!doc)throw Error('정상적인 DOCX 파일이 아닙니다.');return textNodes(doc,'w:t').join('\n');}
 if(extension==='pptx')return Object.keys(files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b)=>parseInt(a.match(/slide(\d+)/)[1])-parseInt(b.match(/slide(\d+)/)[1])).map((n,i)=>`[슬라이드 ${i+1}]\n${textNodes(xml(n),'a:t').join('\n')}`).join('\n\n');
 if(extension==='xlsx'){
 const shared=arr(xml('xl/sharedStrings.xml')?.sst?.si).map(s=>textNodes(s,'t').join(''));
 return Object.keys(files).filter(n=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a,b)=>parseInt(a.match(/sheet(\d+)/)[1])-parseInt(b.match(/sheet(\d+)/)[1])).map((n,i)=>{
 const rows=arr(xml(n)?.worksheet?.sheetData?.row);return `[시트 ${i+1}]\n`+rows.map(row=>arr(row.c).map(c=>{const type=c['@_t'];let value=type==='s'?shared[Number(c.v)]||'':type==='inlineStr'?textNodes(c.is,'t').join(''):String(c.v??'');return `${c['@_r']||''}: ${value}${c.f?' [수식 캐시값]':''}`;}).join(' | ')).join('\n');}).join('\n\n');
 }
 throw Error('지원하지 않는 문서 형식입니다.');
}
async function pdfText(bytes){
 const pdfjs=await import('pdfjs-dist/build/pdf.mjs');const worker=await import('pdfjs-dist/build/pdf.worker.min.mjs?url');pdfjs.GlobalWorkerOptions.workerSrc=worker.default;
 const loading=pdfjs.getDocument({data:bytes,isEvalSupported:false,useSystemFonts:true});let doc;
 try{doc=await loading.promise;if(doc.numPages>200)throw Error('PDF는 200쪽 이하로 나누어 주세요.');const parts=[];let length=0;for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n);const content=await page.getTextContent();const text=content.items.map(i=>i.str+(i.hasEOL?'\n':' ')).join('');length+=text.length;if(length>MAX_TEXT)throw Error('PDF 본문이 너무 깁니다. 나누어 주세요.');parts.push(`[${n}쪽]\n${text}`);page.cleanup();}const result=parts.join('\n\n');if(!result.replace(/\[\d+쪽\]/g,'').trim())throw Error('텍스트 없는 스캔 PDF입니다. OCR 후 다시 가져오세요.');return result;}finally{await loading.destroy();}
}
export async function extractDocument(file){
 if(file.size>MAX_FILE)throw Error('파일당 20MB까지 지원합니다.');const ext=file.name.split('.').pop().toLowerCase();
 if(['txt','md','csv','eml','json'].includes(ext))return file.text();
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(ext==='pdf')return pdfText(bytes);
 if(['docx','pptx','xlsx'].includes(ext))return officeText(bytes,ext);
 throw Error('지원하지 않는 형식입니다. HWP·이미지는 텍스트 또는 PDF로 변환하세요.');
}
export async function readDocumentBatch(input){
 let files=Array.from(input);if(files.length>100||files.reduce((s,f)=>s+f.size,0)>MAX_TOTAL)throw Error('한 번에 100개·합계 50MB까지 가능합니다.');
 const expanded=[],issues=[];
 for(const f of files){if(!/\.zip$/i.test(f.name)){expanded.push(f);continue;}try{if(f.size>MAX_FILE)throw Error('ZIP 파일당 20MB 한도');const entries=boundedUnzip(new Uint8Array(await f.arrayBuffer()));for(const [name,bytes]of Object.entries(entries)){if(name.includes('__MACOSX')||name.split('/').some(s=>s.startsWith('.')))continue;expanded.push({name,webkitRelativePath:f.name+'/'+name,size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer,text:async()=>strFromU8(bytes)});}}catch(e){issues.push(`${f.name}: ${e.message}`);}}
 if(expanded.length>100)throw Error('압축 해제한 파일이 100개를 넘습니다. 나누어 주세요.');
 let length=0;const documents=[];
 for(const f of expanded){try{const text=await extractDocument(f);if(!text.trim())throw Error('추출된 본문이 없습니다.');length+=new TextEncoder().encode(text).length;if(length>MAX_TEXT)throw Error('추출 본문 합계가 650KB를 넘습니다. 나누어 주세요.');documents.push({name:f.webkitRelativePath||f.name,text});}catch(e){issues.push(`${f.name}: ${e.message}`);}}
 return {documents,issues,text:documents.map(d=>`[파일: ${d.name}]\n${d.text}`).join('\n\n')};
}

export function officeText(bytes,extension){return officeTextRaw(bytes,extension).replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(match,value)=>{const code=value[0].toLowerCase()==='x'?parseInt(value.slice(1),16):Number(value);return code>0&&code<=0x10ffff?String.fromCodePoint(code):match;});}
