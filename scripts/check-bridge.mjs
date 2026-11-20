import {loadBridgeConfig} from '../bridge/config.js';
import {checkBridge} from '../bridge/preflight.js';
try{const result=await checkBridge(loadBridgeConfig(process.env));console.log(JSON.stringify(result,null,2));console.log('Infrastructure only. Verify each employee OAuth login and an authorized read/write separately.');if(!result.infrastructure_ready)process.exitCode=1;}catch{console.error('Bridge configuration is incomplete or invalid. Check bridge/.env.example; values are not printed.');process.exitCode=1;}
