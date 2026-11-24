// Presentation only. This controller never reads or writes work data or preferences.
// Keep animation clocks outside app.innerHTML so background refreshes cannot replay them.
const EASE='cubic-bezier(.22,1,.36,1)';
const NAV_DURATION=360;
const REVEAL_DURATION=1450;
const INTRO_END=2900;
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
 let weatherGhost=null,weatherAnimations=[];
 const running=new Set();
 function stop(){for(const animation of running)animation.cancel();running.clear();}
 function animate(node,frames,duration,delay=0,start=win.performance.now(),easing=EASE,done=()=>{}){
  const elapsed=win.performance.now()-start;
  if(!node?.getClientRects().length||!node.animate||reduced.matches||elapsed>=duration+delay){done();return;}
  const animation=node.animate(frames,{duration,delay,easing,fill:'backwards'});
  animation.currentTime=Math.max(0,elapsed);running.add(animation);
  animation.oncancel=()=>{running.delete(animation);done();};
  animation.onfinish=()=>{running.delete(animation);done();animation.cancel();};
  return animation;
 }
 function clearWeather(){
  for(const animation of weatherAnimations)animation?.cancel();
  weatherAnimations=[];weatherGhost?.remove();weatherGhost=null;
 }
 // Replace weather immediately; the outgoing copy is decorative and cannot receive focus.
 // A quick second click or a background refresh cancels the old transition cleanly.
 function weather(widget,replace,direction=0){
  clearWeather();
  const old=widget?.querySelector('.weather-page');
  if(!old||!direction||reduced.matches){replace();return;}
  const bounds=old.getBoundingClientRect(),host=widget.getBoundingClientRect();
  const ghost=old.cloneNode(true),sign=Math.sign(direction),start=win.performance.now();
  ghost.classList.add('weather-motion-ghost');ghost.setAttribute('aria-hidden','true');ghost.setAttribute('inert','');ghost.removeAttribute('tabindex');
  ghost.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
  ghost.style.cssText=`position:absolute;left:${bounds.left-host.left-widget.clientLeft}px;top:${bounds.top-host.top-widget.clientTop}px;width:${bounds.width}px;height:${bounds.height}px;pointer-events:none`;
  replace();weatherGhost=ghost;widget.append(ghost);
  const page=widget.querySelector('.weather-page:not(.weather-motion-ghost)');
  weatherAnimations=[
   animate(ghost,[{opacity:1,transform:'translateX(0) scale(1)',filter:'blur(0px)'},{opacity:0,transform:`translateX(${-sign*65}px) scale(.92)`,filter:'blur(3px)'}],340,0,start,EASE,()=>ghost.remove()),
   animate(page,[{opacity:0,transform:`perspective(600px) translateX(${sign*85}px) rotateY(${-sign*12}deg) scale(.92)`,filter:'blur(3px)'},{opacity:1,transform:'perspective(600px) translateX(0) rotateY(0deg) scale(1)',filter:'blur(0px)'}],560,0,start)
  ];
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
 reduced.addEventListener('change',()=>{if(reduced.matches){stop();clearWeather();sequence=null;navTravel=null;hideTip();}});

 function capture(nextRoot){
  clearWeather();
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
  const now=win.performance.now();if(now-start>(kind==='intro'?INTRO_END:1500)){sequence=null;return;}
  const rise=[{opacity:0,transform:`perspective(1000px) translateY(${desktop.matches?46:24}px) rotateX(${desktop.matches?7:0}deg) scale(.93)`,filter:'blur(4px)',offset:0},{opacity:1,transform:'perspective(1000px) translateY(-4px) rotateX(0deg) scale(1.012)',filter:'blur(0px)',offset:.78},{opacity:1,transform:'perspective(1000px) translateY(0) rotateX(0deg) scale(1)',filter:'blur(0px)',offset:1}];
  const cards=(selector,delay)=>root.querySelectorAll(selector).forEach(node=>animate(node,rise,680,delay,start));
  const rows=(selector,delay,step=90)=>[...root.querySelectorAll(selector)].filter(node=>node.getClientRects().length).slice(0,6).forEach((node,index)=>animate(node,[{opacity:0,transform:`translateX(${desktop.matches?38:22}px) scale(.96)`,filter:'blur(3px)'},{opacity:1,transform:'translateX(0) scale(1)',filter:'blur(0px)'}],520,delay+index*step,start));
  if(kind==='intro'){
   const area=root.querySelector('.work-area'),rect=area?.getBoundingClientRect(),stage=root.querySelector('.layout');
   if(rect){
    const radius=Math.ceil(Math.hypot(Math.max(36,rect.width-36),Math.max(36,rect.height-36)));
    const duration=desktop.matches?REVEAL_DURATION:1100;
    if(now-start<duration)stage.classList.add('motion-reveal-stage');
    animate(area,[{clipPath:'circle(0px at 36px 36px)',offset:0},{clipPath:'circle(32px at 36px 36px)',offset:.14},{clipPath:`circle(${radius}px at 36px 36px)`,offset:1}],duration,0,start,'cubic-bezier(.5,0,.25,1)',()=>stage.classList.remove('motion-reveal-stage'));
   }
   if(desktop.matches){
    animate(root.querySelector('.sidebar'),[{opacity:.2,transform:'translateX(-8px)'},{opacity:1,transform:'translateX(0)'}],340,0,start);
   }
   // Panels begin after the circle has exposed their area; list rows follow their panel.
   cards('.title-copy',430);cards('.scenic-banner',550);cards('.weather-panel',670);
   cards('.shared-briefing',850);cards('#viewBody>.panel,#viewBody>.calendar-layout>.panel',1040);
   cards('.work-agenda>.agenda-panel',1240);cards('.shared-files>.files-panel',1420);cards('.work-progress',320);
   rows('#viewBody .panel-scroll>.task-card,#viewBody .panel-scroll>.link-card,#viewBody .panel-scroll>.message-card',1260,75);
   rows('.work-agenda .agenda-item',1470);rows('.shared-files .file-card',1640,75);
  }else if(kind==='page'){
   animate(root.querySelector('.title-copy'),[{opacity:.2,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],240,0,start);
   const body=root.querySelector('.unified-search-panel')||root.querySelector('#viewBody');
   animate(body,[{opacity:.2,transform:`translateX(${desktop.matches?16:6}px)`},{opacity:1,transform:'translateX(0)'}],340,0,start);
   cards('.shared-briefing',60);cards('.work-agenda>.agenda-panel',170);
   rows('.work-agenda .agenda-item',300);
  }
  if(kind!=='intro'){
   const target=!desktop.matches&&previous.mobilePanel==='agenda'?'.work-agenda':!desktop.matches&&previous.mobilePanel==='files'?'.shared-files':'#viewBody';
   const selector=target+' .panel-scroll>:is(.task-card,.link-card,.message-card,.agenda-item,.file-card,.hidden-item)';
   if(root.querySelector(selector))rows(selector,kind==='page'?100:0,65);
   else if(kind==='content')animate(root.querySelector(target),[{opacity:.25,translate:'0 16px'},{opacity:1,translate:'0 0'}],380,0,start);
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
 return {capture,refresh,weather,reset(){stop();clearWeather();hideTip();root?.querySelectorAll('.motion-nav-indicator').forEach(n=>n.remove());root?.classList.remove('visual-motion-ready');previous=null;sequence=null;navTravel=null;navKey=null;captured=null;}};
}
