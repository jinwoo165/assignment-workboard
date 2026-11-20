import {spawnSync} from 'node:child_process';
import {loadBridgeConfig} from '../bridge/config.js';
import {validateAssignmentConfig} from '../src/assignment-config.js';
// Configuration values remain environment data; never interpolate them into shell commands.
const config=loadBridgeConfig(process.env);
const env={...process.env,VITE_ASSIGNMENT_PROJECT_REF:config.projectRef,VITE_ASSIGNMENT_SUPABASE_URL:config.supabaseUrl,VITE_ASSIGNMENT_SUPABASE_KEY:config.publishableKey,VITE_ASSIGNMENT_MCP_URL:config.resource};
const validated=validateAssignmentConfig(env);if(!validated.configured)throw Error(validated.error);
for(const args of [['scripts/check-isolation.mjs','--deployment'],['node_modules/vite/bin/vite.js','build','--base=./','--outDir','docs'],['scripts/check-isolation.mjs']]){const result=spawnSync(process.execPath,args,{env,stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
