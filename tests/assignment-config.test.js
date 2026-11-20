import test from 'node:test';import assert from 'node:assert/strict';
import {validateAssignmentConfig,FORBIDDEN_PROJECT_REFS} from '../src/assignment-config.js';
const ref='abcdefghijklmnopqrst';const valid={VITE_ASSIGNMENT_SUPABASE_URL:`https://${ref}.supabase.co`,VITE_ASSIGNMENT_PROJECT_REF:ref,VITE_ASSIGNMENT_SUPABASE_KEY:'sb_publishable_TEST_ONLY'};
test('unconfigured assignment does not fall back to a live service',()=>assert.equal(validateAssignmentConfig({}).configured,false));
test('every known existing project is rejected regardless of matching key',()=>{for(const r of FORBIDDEN_PROJECT_REFS)assert.equal(validateAssignmentConfig({...valid,VITE_ASSIGNMENT_PROJECT_REF:r,VITE_ASSIGNMENT_SUPABASE_URL:`https://${r}.supabase.co`}).configured,false)});
test('project mismatch and server secret are rejected',()=>{assert.equal(validateAssignmentConfig({...valid,VITE_ASSIGNMENT_PROJECT_REF:'zzzzzzzzzzzzzzzzzzzz'}).configured,false);assert.equal(validateAssignmentConfig({...valid,VITE_ASSIGNMENT_SUPABASE_KEY:'sb_secret_NEVER_BROWSER'}).configured,false)});
test('explicit assignment configuration passes without relying on production',()=>assert.equal(validateAssignmentConfig(valid).configured,true));
test('connection URLs reject credentials query fragments insecure transport',()=>{for(const url of ['http://example.com/mcp','https://u:p@example.com/mcp','https://example.com/mcp?token=abc','https://example.com/mcp#abc'])assert.equal(validateAssignmentConfig({...valid,VITE_ASSIGNMENT_MCP_URL:url}).configured,false)});
