import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import config from '../vite.config.js';
test('compiled app version tracks the published update manifest',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../public/version.json',import.meta.url),'utf8'));
 assert.equal(JSON.parse(config.define.__APP_VERSION__),manifest.version);
 const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 assert.match(source,/const APP_VERSION=__APP_VERSION__;/);
});
