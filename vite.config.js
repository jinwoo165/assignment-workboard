import {defineConfig} from 'vite';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
const release=JSON.parse(readFileSync(new URL('./public/version.json',import.meta.url),'utf8'));
if(!/^\d+\.\d+\.\d+$/.test(release.version))throw new Error('Invalid release version');
export default defineConfig({define:{__APP_VERSION__:JSON.stringify(release.version)},build:{rollupOptions:{input:{main:resolve('index.html'),consent:resolve('bridge/consent.html'),microsoft:resolve('microsoft-callback.html'),documentCheck:resolve('document-check.html')}}}});
