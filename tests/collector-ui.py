import json
import shutil
from playwright.sync_api import sync_playwright, expect
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path=shutil.which("chromium"))
 page=b.new_page(viewport={'width':1440,'height':1000})
 errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://localhost:5173/?demo=1')
 page.wait_for_load_state('networkidle')
 print(page.get_by_role('button').all_text_contents()[:30])
 page.locator('.assignment-ai-button').click()
 page.get_by_role('button',name='수집 도구 전달',exact=True).click()
 expect(page.get_by_role('heading',name='수집 도구 전달')).to_be_visible()
 page.locator('summary').filter(has_text='수집 도구가 읽을').click()
 context=json.loads(page.get_by_label('수집 도구용 업무 정보').input_value())
 assert context['tasks'] and context['format']['type']=='dahandot.feed'
 assert not page.locator('[data-collector-auto]').is_checked()
 feed={'type':'dahandot.feed','schema_version':1,'batch_id':'ui-run-1','generated_at':'2026-01-01T00:00:00Z','tasks':[{'id':'ui-task-1','title':'수집 자동 반영 시험','source_refs':[{'title':'합성 회의록','context':'자동 반영 시험'}]}],'events':[],'sources':[]}
 page.get_by_label('수집 도구 결과').fill(json.dumps(feed))
 page.get_by_role('button',name='체험 보드에 반영').click()
 expect(page.locator('[data-collector-status]')).to_have_attribute('data-state','saved')
 context=json.loads(page.get_by_label('수집 도구용 업무 정보').input_value())
 assert any(t['id']=='ui-task-1' for t in context['tasks'])
 page.locator('[data-collector-auto]').check()
 feed['batch_id']='ui-run-2';feed['tasks'][0]['id']='ui-task-2';feed['tasks'][0]['title']='파일 자동 반영 시험'
 page.locator('[data-collector-file]').set_input_files({'name':'feed.json','mimeType':'application/json','buffer':json.dumps(feed).encode()})
 expect(page.locator('[data-collector-status]')).to_have_attribute('data-state','saved')
 context=json.loads(page.get_by_label('수집 도구용 업무 정보').input_value())
 assert any(t['id']=='ui-task-2' for t in context['tasks'])
 page.locator('[data-collector-file]').set_input_files({'name':'bad.json','mimeType':'application/json','buffer':b'not-json'})
 expect(page.locator('[data-collector-status]')).to_have_attribute('data-state','error')
 assert page.get_by_label('수집 도구 결과').input_value()==''
 assert not errors,errors
 print('PASS: context, manual delivery, file auto delivery, invalid file blocked; demo only')
 b.close()
