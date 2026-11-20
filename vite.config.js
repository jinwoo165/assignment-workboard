import {defineConfig} from 'vite';
import {resolve} from 'node:path';
export default defineConfig({build:{rollupOptions:{input:{main:resolve('index.html'),consent:resolve('bridge/consent.html'),microsoft:resolve('microsoft-callback.html'),documentCheck:resolve('document-check.html')}}}});
