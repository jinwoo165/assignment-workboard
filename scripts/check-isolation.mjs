import fs from 'node:fs';import path from 'node:path';import {personalConfig} from '../src/personal-drive.js';
const root=process.cwd();const failures=[];let checked=0;
const forbidden=['https://qiwgesnpcqqnmovnpvnh.supabase.co','sb_publishable_tUjdEhmUZDCJZuFPyCoVBQ_yTAUBAJF','https://jinwoo165.github.io/dahandot-workdesk/'];
for(const dir of ['src','public','docs','bridge']){if(!fs.existsSync(dir))continue;for(const file of fs.readdirSync(dir,{recursive:true})){const name=path.join(dir,file);if(!fs.statSync(name).isFile()||! /\.(js|mjs|json|html|css|md)$/.test(name))continue;checked++;const text=fs.readFileSync(name,'utf8');for(const value of forbidden)if(text.includes(value))failures.push(`${name}: production connection reference`);}}
if(fs.existsSync('.git/config')){const git=fs.readFileSync('.git/config','utf8');if(/url\s*=.*[/:]jinwoo165\/dahandot-workdesk(?:\.git)?\s*$/m.test(git))failures.push('Git remote points to production');}
if(process.argv.includes('--deployment')){const c=personalConfig(process.env);if(!c.configured)failures.push(c.error);}
if(failures.length){console.error(failures.join('\n'));process.exit(1)}console.log(`Isolation checks passed (${checked} files). No production URL/key or production remote.`);
