export function conversation(id, count) {
  const mapping = { root: { id: 'root', parent: null, message: null } };
  let parent = 'root';
  for (let i = 0; i < count; i++) {
    const user = `${id}-u-${i}`;
    const assistant = `${id}-a-${i}`;
    mapping[user] = { id: user, parent, message: { id: user, author: { role: 'user' }, content: { parts: [prompt(i)] } } };
    mapping[assistant] = { id: assistant, parent: user, message: { id: assistant, author: { role: 'assistant' }, content: { parts: ['回答内容'] } } };
    parent = assistant;
  }
  mapping.obsolete = { id: 'obsolete', parent: `${id}-a-0`, message: { id: 'obsolete', author: { role: 'user' }, content: { parts: ['不应出现的旧分支'] } } };
  return { conversation_id: id, current_node: parent, mapping };
}

export function prompt(i) {
  if (i === 3 || i === 4) return '重复的问题：为什么标准化之后权重会变化？';
  if (i === 8) return '多行提问\n第二行继续讨论梯度下降';
  if (i === 11) return '<img src=x onerror="window.injected=true"> 这段 HTML 应按文本显示';
  return `${String(i + 1).padStart(3, '0')} · 为什么标准化后，不是把原数字都变成一样了？`;
}

export const fixtureHTML = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="color-scheme" content="light dark"><title>对话目录 · 浏览器验证</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#fff;color:#202123;font-family:Arial,'Microsoft YaHei',sans-serif}html.dark body{background:#202123;color:#ececf1}header.page-header{height:58px;padding:16px 30px;border-bottom:1px solid #8882;display:flex;justify-content:space-between;position:relative;z-index:2;background:inherit}h1{font-size:17px;margin:0;font-weight:500}aside.page-sidebar{position:fixed;left:0;top:58px;bottom:0;width:190px;background:#88808;padding:28px 18px;font-size:13px;line-height:2.4;color:#888}main{margin-left:190px}.thread-scroll-container{height:calc(100vh - 58px);overflow-y:auto;overflow-anchor:none;position:relative}.content{max-width:780px;margin:auto;padding:0 36px}.turn{overflow:hidden;padding:24px 0 0}.user{display:flex;justify-content:flex-end}.bubble{background:#8881;border-radius:18px;padding:12px 18px;max-width:85%;font-size:15px;white-space:pre-wrap}.assistant{padding:22px 0;line-height:1.9;font-size:15px}.assistant p{margin:0 0 12px;color:#777}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}@media(max-width:760px){aside.page-sidebar{display:none}main{margin:0}.content{padding:0 25px}}
</style><script src="/bridge.js"></script><script src="/content.js"></script></head><body>
<header class="page-header"><h1>ChatGPT <span style="color:#aaa;font-size:12px">· 本地测试会话</span></h1><span style="font-size:12px;color:#999">对话目录验证</span></header>
<aside class="page-sidebar">新聊天<br>搜索聊天<br><br>今天<br>标准化与梯度下降<br>损失函数的理解</aside>
<main hidden><div data-message-author-role="user" data-message-id="hidden-old">其他会话的秘密提问</div></main>
<main id="active-main"><div class="thread-scroll-container" role="region" aria-label="对话" data-app-action-timeline-scroll><div class="content"></div></div></main>
<script type="module">
const query = new URLSearchParams(location.search);
let count = Number(query.get('count') || 300);
let id = location.pathname.split('/').at(-1);
let virtual = query.get('virtual') !== '0';
let old = query.get('old') === '1';
let noData = query.get('data') === '0';
let xhrMode = query.get('xhr') === '1';
let proof = query.get('proof') === '1';
let content = document.querySelector('#active-main .content');
let scroller = content.parentElement;
let heights = [], offsets = [];
let currentWindow = '';
let stuck = false;
function prompt(i) {
 if(i===3 || i===4)return '重复的问题：为什么标准化之后权重会变化？';
 if(i===8)return '多行提问\\n第二行继续讨论梯度下降';
 if(i===11)return '<img src=x onerror="window.injected=true"> 这段 HTML 应按文本显示';
 return String(i+1).padStart(3,'0')+' · 为什么标准化后，不是把原数字都变成一样了？';
}
function metrics(){ heights = Array.from({length:count},(_,i)=> 230+(i%7)*41);let y=0;offsets=heights.map(h=>{const v=y;y+=h;return v});offsets.push(y) }
function render(force=false){
 let start=0,end=count;
 if(virtual){start=Math.max(0,offsets.findIndex((y,i)=> i<count && y+heights[i] > scroller.scrollTop-scroller.clientHeight));end=Math.min(count,start+12)}
 const key = [start,end,count,id,old].join(':');
 if(!force && key===currentWindow)return;currentWindow=key;
 if(stuck){ content.replaceChildren(); const space=document.createElement('div');space.style.height=offsets.at(-1)+'px';content.append(space);return }
 const nodes=[];const before=document.createElement('div');before.style.height=offsets[start]+'px';nodes.push(before);
 for(let i=start;i<end;i++){
  const turn=document.createElement('div');turn.className='turn';turn.style.height=heights[i]+'px';
  turn.setAttribute('data-content-search-turn-key','fallback-turn-'+i);
  if(old)turn.setAttribute('data-testid','conversation-turn-'+i);
  if(i===0 && proof)turn.dataset.conversationStart='true';
  const user=document.createElement('div');user.className='user';
  const uid=id+'-u-'+i;
  const bubble=document.createElement('div');bubble.className='bubble';
  if(old){user.dataset.messageAuthorRole='user';user.dataset.messageId=uid}else{user.dataset.chatgptSearchMessageIds=uid;bubble.dataset.userMessageBubble='true'}
  bubble.textContent=prompt(i);user.append(bubble);
  const answer=document.createElement('div');answer.className='assistant';
  if(old){answer.dataset.messageAuthorRole='assistant';answer.dataset.messageId=id+'-a-'+i}else{answer.dataset.chatgptSearchMessageIds=id+'-a-'+i}
  const p=document.createElement('p');p.textContent='ChatGPT';answer.append(p);
  const text=document.createElement('div');text.textContent='标准化改变了特征的尺度，因此同一个学习率会带来不同的权重更新。我们可以结合损失函数与正则化，一步一步观察这个过程。';answer.append(text);
  turn.append(user,answer);nodes.push(turn);
 }
 const after=document.createElement('div');after.style.height=(offsets.at(-1)-offsets[end])+'px';nodes.push(after);content.replaceChildren(...nodes);
}
function load(){
 const path='/backend-api/conversation/'+id+'?count='+count+(noData?'&invalid=1':'');
 if(xhrMode){const xhr=new XMLHttpRequest();xhr.open('GET',path);xhr.responseType='json';xhr.send()}else fetch(path).then(r=>r.json()).catch(()=>{});
}
scroller.addEventListener('scroll',()=>render());
metrics();render();scroller.scrollTop=offsets.at(-1);render();load();
window.fixture={
  get state(){return {id,count,virtual,scrollTop:scroller.scrollTop,scrollHeight:scroller.scrollHeight}},
  scroll(i){scroller.scrollTop=offsets[i];render()},
  scrollAnswer(i){scroller.scrollTop=offsets[i]+140;render()},
  append(){count++;metrics();render(true);scroller.scrollTop=offsets.at(-1);render()},
  appendAlone(){count++;metrics();render(true);scroller.scrollTop=offsets.at(-1);render();for(const e of content.querySelectorAll('.user'))if(e.getAttribute('data-chatgpt-search-message-ids')!==id+'-u-'+(count-1))e.style.display='none'},
  removeAll(){stuck=true;render(true)},
  async navigate(next, n=3){history.pushState({},'', '/c/'+next);id=next;count=n;metrics();scroller.scrollTop=0;render(true);load()},
  async navigateDelayed(next,n=3){history.pushState({},'', '/c/'+next);fetch('/backend-api/conversation/'+next+'?count='+n);await new Promise(r=>setTimeout(r,1000));id=next;count=n;metrics();scroller.scrollTop=0;render(true)},
  load(){load()},
  replaceBranch(){id=id;count=2;metrics(); const first=content.querySelector('[data-chatgpt-search-message-ids]');render(true);const last=content.querySelector('[data-chatgpt-search-message-ids="'+id+'-u-1"]');if(last)last.dataset.chatgptSearchMessageIds='replacement-id'},
};
</script></body></html>`;
