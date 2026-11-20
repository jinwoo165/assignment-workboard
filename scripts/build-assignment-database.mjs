import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const files=['schema.sql','conversations.sql','files.sql','managed-links.sql','link-pins.sql','file-summaries.sql','collection-results.sql','briefing-visibility.sql','item-visibility.sql','onedrive-scoped-completion.sql','dooray-body-completion.sql','assignment-followthrough.sql','assignment-bootstrap.sql','user-sync.sql'];
export function databaseSQL(){
 const guard=`-- ONE-TIME INITIAL INSTALL: fresh, separate Supabase assignment project only.\n-- No original business data, API keys, schedules or secrets are included.\nbegin;\ndo $$ begin\n if to_regclass('public.workspaces') is not null or exists(select 1 from pg_namespace where nspname='workdesk_private') then\n  raise exception 'STOP: Existing workboard schema detected. This installer only supports an empty assignment project.';\n end if;\nend $$;\n`;
 return guard+files.map(name=>'\n-- SOURCE: '+name+'\n'+fs.readFileSync(path.join(root,'database',name),'utf8').replace(/^\s*(begin|commit);\s*$/gmi,'')).join('\n;\n')+'\n;\ncommit;\n';
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const target=path.join(root,'database/assignment-install.sql');fs.writeFileSync(target,databaseSQL());console.log('Generated database/assignment-install.sql');
}
