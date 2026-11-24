// Presentation only. This controller never reads or writes work data or preferences.
// Keep animation clocks outside app.innerHTML so background refreshes cannot replay them.
const EASE='cubic-bezier(.22,1,.36,1)';
const NAV_DURATION=360;
export function visualChange(previous,next){
 if(!previous||previous.scope!==next.scope)return 'intro';
 if(previous.view!==next.view)return 'page';
 if(previous.detail!==next.detail)return 'content';
 return null;
}

export function createVisualMotion({window:win=window}={}){
 const doc=win.document,reduced=win.matchMedia('(prefers-reduced-motion: reduce)');
 const desktop=win.matchMedia('(min-width:901px)'),hover=win.matchMedia('(hover:hover)');
 let previous=null,sequence=null,root=null,navTravel=null,navKey=null,captured=null,tooltip=null,tipOwner=null;
 const running=new Set();
 function stop(){for(const animation of running)animation.cancel();running.clear();}
 function animate(node,frames,duration,delay=0,start=win.performance.now()){
  const elapsed=win.performance.now()-start;
  if(!node?.getClientRects().length||!node.animate||reduced.matches||elapsed>=duration+delay)return;
  const animation=node.animate(frames,{duration,delay,easing:EASE,fill:'backwards'});
  animation.currentTime=Math.max(0,elapsed);running.add(animation);
  animation.onfinish=()=>{running.delete(animation);animation.cancel();};
 }
 function hideTip(){
  if(tooltip)tooltip.hidden=true;
  if(tipOwner){
   const ids=(tipOwner.getAttribute('aria-describedby')||'').split(/\s+/).filter(id=>id&&id!=='board-motion-tooltip');
   if(ids.length)tipOwner.setAttribute('aria-describedby',ids.join(' '));else tipOwner.removeAttribute('aria-describedby');
  }
  tipOwner=null;
 }
 function showTip(button){
  hideTip();if(!button||!desktop.matches||!button.dataset.motionTip)return;
  if(!tooltip){tooltip=doc.createElement('div');tooltip.id='board-motion-tooltip';tooltip.className='motion-tooltip';tooltip.setAttribute('role','tooltip');doc.body.append(tooltip);}
  tooltip.textContent=button.dataset.motionTip.replace(/\n/g,' ');tooltip.hidden=false;
  tipOwner=button;
  button.setAttribute('aria-describedby',[(button.getAttribute('aria-describedby')||''),'board-motion-tooltip'].filter(Boolean).join(' '));
  const rect=button.getBoundingClientRect();
  tooltip.style.left=Math.max(8,Math.min(rect.right+12,win.innerWidth-tooltip.offsetWidth-8))+'px';
  tooltip.style.top=Math.max(8,Math.min(rect.top+(rect.height-tooltip.offsetHeight)/2,win.innerHeight-tooltip.offsetHeight-8))+'px';
 }
 function bindTips(nextRoot){
  if(root===nextRoot)return;
  nextRoot.addEventListener('pointerover',event=>{const b=event.target.closest('[data-motion-tip]');if(hover.matches&&b&&!b.contains(event.relatedTarget))showTip(b);});
  nextRoot.addEventListener('pointerout',event=>{if(tipOwner&&!tipOwner.contains(event.relatedTarget))hideTip();});
  nextRoot.addEventListener('focusin',event=>{if(event.target.matches('[data-motion-tip]'))showTip(event.target);});
  nextRoot.addEventListener('focusout',hideTip);
  nextRoot.addEventListener('pointerdown',hideTip);
 }
 doc.addEventListener('keydown',event=>{if(event.key==='Escape')hideTip();});
 doc.addEventListener('scroll',hideTip,true);
 win.addEventListener('resize',hideTip);
 reduced.addEventListener('change',()=>{if(reduced.matches){stop();sequence=null;navTravel=null;hideTip();}});

 function capture(nextRoot){
  const nav=nextRoot.querySelector('.sidebar .nav'),marker=nav?.querySelector('.motion-nav-indicator');
  const n=nav?.getBoundingClientRect(),m=marker?.getBoundingClientRect();
  const active=doc.activeElement;
  const focus=active?.closest('.nav [data-view],.task-filters [data-task-filter]');
  captured={
   marker:n&&m?{x:m.left-n.left,y:m.top-n.top,width:m.width,height:m.height}:null,
   focus:focus?(focus.dataset.view?['data-view',focus.dataset.view]:['data-task-filter',focus.dataset.taskFilter]):null,
   sidebarScroll:nextRoot.querySelector('.sidebar')?.scrollTop||0
  };
  hideTip();
 }
 function moveSelection(){
  const nav=root.querySelector('.sidebar .nav'),button=nav?.querySelector('button.active');
  if(!nav||!button||!desktop.matches){navKey=null;navTravel=null;return;}
  const n=nav.getBoundingClientRect(),b=button.getBoundingClientRect();
  const target={x:b.left-n.left,y:b.top-n.top,width:b.width,height:b.height};
  const key=button.dataset.view;
  if(navKey!==key&&captured?.marker)navTravel={from:captured.marker,start:win.performance.now()};
  navKey=key;
  const marker=doc.createElement('span');marker.className='motion-nav-indicator';marker.setAttribute('aria-hidden','true');
  marker.innerHTML='<span class="motion-nav-orb"></span>';
  marker.style.cssText=`width:${target.width}px;height:${target.height}px;transform:translate(${target.x}px,${target.y}px)`;
  nav.prepend(marker);nav.classList.add('motion-nav');button.setAttribute('aria-current','page');
  if(navTravel){
   const f=navTravel.from;
   animate(marker,[{transform:`translate(${f.x}px,${f.y}px)`,width:f.width+'px',height:f.height+'px'},{transform:`translate(${target.x}px,${target.y}px)`,width:target.width+'px',height:target.height+'px'}],NAV_DURATION,0,navTravel.start);
   if(win.performance.now()-navTravel.start>=NAV_DURATION)navTravel=null;
  }
 }
 function reveal(){
  if(!sequence||reduced.matches)return;
  const {kind,start}=sequence;
  const now=win.performance.now();if(now-start>800){sequence=null;return;}
  const rise=[{opacity:0,transform:'translateY(12px)'},{opacity:1,transform:'translateY(0)'}];
  if(kind==='intro'){
   if(desktop.matches){
    const area=root.querySelector('.work-area'),rect=area?.getBoundingClientRect();
    if(rect)animate(area,[{clipPath:'circle(24px at 30px 30px)'},{clipPath:`circle(${Math.ceil(Math.hypot(rect.width,rect.height))}px at 30px 30px)`}],620,0,start);
    animate(root.querySelector('.sidebar'),[{opacity:.2,transform:'translateX(-8px)'},{opacity:1,transform:'translateX(0)'}],340,0,start);
   }
   const selectors=['.title-copy','.scenic-banner','.weather-panel','.shared-briefing','#viewBody','.work-agenda','.shared-files','.work-progress'];
   selectors.forEach((selector,index)=>animate(root.querySelector(selector),rise,360,Math.min(index*35,210),start));
  }else if(kind==='page'){
   animate(root.querySelector('.title-copy'),[{opacity:.2,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],240,0,start);
   const body=root.querySelector('.unified-search-panel')||root.querySelector('#viewBody');
   animate(body,[{opacity:.2,transform:`translateX(${desktop.matches?16:6}px)`},{opacity:1,transform:'translateX(0)'}],340,0,start);
   animate(root.querySelector('.shared-briefing'),rise,300,30,start);
  }
  if(kind!=='intro'){
   const items=[...root.querySelectorAll('#viewBody .panel-scroll>.task-card,#viewBody .panel-scroll>.link-card,#viewBody .panel-scroll>.message-card')].filter(n=>n.getClientRects().length).slice(0,6);
   if(items.length)items.forEach((node,index)=>animate(node,rise,220,index*24,start));
   else if(kind==='content')animate(root.querySelector('#viewBody'),[{opacity:.35},{opacity:1}],200,0,start);
  }
 }
 function refresh(nextRoot,next){
  bindTips(nextRoot);root=nextRoot;stop();
  root.classList.add('visual-motion-ready');
  const kind=visualChange(previous,next);
  if(kind){sequence={kind,start:win.performance.now()};if(kind==='intro'){navKey=null;navTravel=null;if(captured)captured.marker=null;}}
  previous={...next};
  const sidebar=root.querySelector('.sidebar');if(sidebar&&captured)sidebar.scrollTop=captured.sidebarScroll;
  moveSelection();
  if(captured?.focus){const [attribute,value]=captured.focus;const selector=attribute==='data-view'?'.sidebar .nav [data-view]':'.task-filters [data-task-filter]';[...root.querySelectorAll(selector)].find(n=>n.getAttribute(attribute)===value)?.focus({preventScroll:true});hideTip();}
  reveal();captured=null;
 }
 return {capture,refresh,reset(){stop();hideTip();root?.querySelectorAll('.motion-nav-indicator').forEach(n=>n.remove());root?.classList.remove('visual-motion-ready');previous=null;sequence=null;navTravel=null;navKey=null;captured=null;}};
}
