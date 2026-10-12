/* Test-only isolated browser contexts and a simulated GAS backend.
 * All GAS requests are intercepted. This suite NEVER posts to the deployed GAS.
 * npm install --no-save playwright && npx playwright install chromium
 * Start a local server first; QA_BASE_URL defaults to http://127.0.0.1:43240/.
 */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:43240/';
const ownKey = 'librarian-sticker-v1', pendingKey = 'librarian-sticker-pending-v1';
const sample = {type:1,rating:'fit',x:.5,y:.5,shape:'circle',color:'#ef4444'};
const backend = {rows:[],receipts:new Map(),posts:[],next:2,listError:false,reject:false,hold:false};
const failures = [];
const zone = (page,type=1,rating='fit') => page.locator(`[data-type="${type}"][data-rating="${rating}"]`);
async function ready(page) { await page.waitForFunction(() => /更新$/.test(document.getElementById('connection-status').textContent)); }
async function own(page) { return page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),ownKey); }
async function pending(page) { return page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),pendingKey); }
async function assertMessage(page,text) { await page.waitForFunction(t=>document.getElementById('save-status').textContent.includes(t),text); }
async function setShortReceiptTimeout(page) {
  await page.evaluate(() => {
    const resume = window.StickerApi.prototype.resumeReceipt;
    window.StickerApi.prototype.resumeReceipt = function(id) { return resume.call(this,id,100); };
  });
}
async function mockGas(route) {
  const request = route.request();
  const headers = await request.allHeaders();
  // Seeded Google cookies must never be sent, even for JSONP script tags.
  assert.equal(headers.cookie,undefined);
  if (request.method() === 'POST') {
    const payload = JSON.parse(request.postData());
    assert.equal(request.headers()['content-type'],'text/plain;charset=UTF-8');
    backend.posts.push(payload);
    if (backend.reject) backend.receipts.set(payload.requestId,{state:'error',error:'テスト用の保存拒否'});
    else {
      const row = payload.operation === 'update' ? payload.row : backend.next++;
      const token = payload.operation === 'update' ? payload.token : `test-signature-${row}`;
      if (payload.operation === 'update') assert.ok(backend.rows.some(s=>s.row === row));
      backend.rows = backend.rows.filter(s=>s.row !== row);
      backend.rows.push({row,...payload.sticker});
      backend.receipts.set(payload.requestId,{state:'success',row,token});
    }
    await route.fulfill({status:200,body:'opaque-response-is-not-used'});
    return;
  }
  const url = new URL(request.url()), action = url.searchParams.get('action');
  assert.ok(['list','receipt'].includes(action));
  assert.equal(url.searchParams.has('token'),false);
  const data = action === 'list' ? (backend.listError ? {ok:false,error:'テスト用の通信エラー'} : {ok:true,stickers:backend.rows}) : backend.hold ? {state:'pending'} : (backend.receipts.get(url.searchParams.get('requestId')) || {state:'pending'});
  assert.equal(headers.origin,new URL(base).origin);
  await route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},contentType:'application/javascript',body:`${url.searchParams.get('callback')}(${JSON.stringify(data)});`});
}
async function newContext(browser,options={}) {
  const context = await browser.newContext(options);
  await context.addCookies([{name:'sticker-test-google-cookie',value:'test-only',domain:'.google.com',path:'/',secure:true,sameSite:'None'}]);
  await context.route('https://script.google.com/**',mockGas);
  context.on('page',page=>page.on('pageerror',err=>failures.push(err.message)));
  return context;
}
(async()=>{
  fs.mkdirSync(path.resolve('test-results'),{recursive:true});
  const browser = await chromium.launch({headless:true, ...(process.env.QA_BROWSER_CHANNEL ? {channel:process.env.QA_BROWSER_CHANNEL} : {})});
  try {
    const c = await newContext(browser,{viewport:{width:1440,height:1000}});
    const p = await c.newPage(); await p.goto(base); await ready(p);
    assert.equal(await p.locator('.type-card').count(),16);
    assert.equal(await p.locator('.sticker-zone').count(),48);
    assert.equal(await p.locator('#total-count').innerText(),'0');
    await zone(p).click({position:{x:1,y:1}});
    assert.equal(await own(p),null);
    assert.equal(await p.locator('.is-draft').count(),1);
    const draftBox = await p.locator('.is-draft').boundingBox(), zoneBox = await zone(p).boundingBox();
    assert.ok(draftBox.x >= zoneBox.x + 2 && draftBox.y >= zoneBox.y + 2);
    await p.locator('#confirm').dblclick(); await assertMessage(p,'貼りました');
    assert.equal(backend.posts.length,1); assert.equal(backend.rows.length,1);
    assert.equal(await p.locator('.is-own').count(),1); assert.equal(await pending(p),null);
    const first = await own(p);
    await p.reload(); await ready(p); assert.equal(await p.locator('.is-own').count(),1);
    await zone(p,16,'surprise').click(); await p.locator('#confirm').click(); await assertMessage(p,'貼りました');
    assert.equal(backend.posts.at(-1).operation,'update');
    assert.equal((await own(p)).row,first.row); assert.equal(backend.rows.length,1);
    assert.equal(await zone(p).locator('.is-own').count(),0);
    assert.equal(await zone(p,16,'surprise').locator('.is-own').count(),1);
    console.log('PASS: 16 types/48 spaces, edge constraint, double click, revisit, one-sticker move');

    await zone(p,3,'okay').press('Enter');
    const before = await p.locator('.is-draft').boundingBox();
    await zone(p,3,'okay').press('ArrowRight');
    const after = await p.locator('.is-draft').boundingBox();
    assert.ok(after.x > before.x);
    await p.locator('#refresh').click(); await ready(p);
    assert.equal(await p.locator('.is-draft').count(),1);
    backend.reject = true;
    const previous = await own(p);
    await p.locator('#confirm').click(); await assertMessage(p,'保存に失敗');
    assert.deepEqual(await own(p),previous); assert.equal(await pending(p),null);
    assert.equal(await p.locator('.is-draft').count(),1);
    backend.reject = false;
    await p.locator('#confirm').click(); await assertMessage(p,'貼りました');
    console.log('PASS: keyboard adjustment, draft survives refresh, rejection and retry');

    backend.listError = true; await p.locator('#refresh').click();
    await p.waitForFunction(()=>!document.getElementById('load-error').hidden);
    assert.ok((await p.locator('#load-error').innerText()).includes('前回取得'));
    assert.equal(await p.locator('.is-own').count(),1);
    backend.listError = false; await p.locator('#refresh').click(); await ready(p);
    console.log('PASS: list failure retains previous data, communication recovery');

    const second = await newContext(browser,{viewport:{width:1024,height:768}});
    const p2 = await second.newPage(); await p2.goto(base); await ready(p2);
    assert.equal(await own(p2),null);
    await zone(p,4).click(); await zone(p2,5).click();
    await Promise.all([p.locator('#confirm').click(),p2.locator('#confirm').click()]);
    await assertMessage(p,'貼りました'); await assertMessage(p2,'貼りました');
    assert.equal(backend.rows.length,2); assert.notEqual((await own(p)).row,(await own(p2)).row);
    await p.locator('#refresh').click(); await ready(p);
    assert.equal(await p.locator('#total-count').innerText(),'2');
    assert.equal(await p.locator('.is-own').count(),1);
    console.log('PASS: simultaneous independent browsers share public stickers, private own highlight');

    backend.hold = true; await setShortReceiptTimeout(p);
    await zone(p,6).click(); await p.locator('#confirm').click();
    await assertMessage(p,'保存結果を確認できませんでした');
    assert.ok(await pending(p));
    const sent = backend.posts.length;
    assert.equal(await p.locator('#confirm').isVisible(),false);
    // Install the short deadline before reload's automatic recovery starts.
    await c.route('**/assets/sticker-api.js*', async route => {
      const response = await route.fetch();
      await route.fulfill({response,body:(await response.text()) + '\nconst qaResume = window.StickerApi.prototype.resumeReceipt; window.StickerApi.prototype.resumeReceipt = function(id) { return qaResume.call(this,id,100); };'});
    });
    await p.reload(); await assertMessage(p,'保存結果を確認できませんでした');
    assert.equal(backend.posts.length,sent);
    backend.hold = false; await p.locator('#receipt-retry').click(); await assertMessage(p,'貼りました');
    assert.equal(backend.posts.length,sent); assert.equal(await pending(p),null);
    assert.equal((await own(p)).type,6);
    console.log('PASS: uncertain receipt persists through reload and recovers without duplicate POST');

    const expired = await newContext(browser);
    const oldId = '12345678-1234-1234-1234-123456789abc';
    await expired.addInitScript(({oldId,sample,pendingKey,origin})=>{
      if (location.origin === origin) localStorage.setItem(pendingKey,JSON.stringify({requestId:oldId,createdAt:Date.now()-660000,payload:{requestId:oldId,operation:'create',sticker:sample}}));
    },{oldId,sample,pendingKey,origin:new URL(base).origin});
    const pe = await expired.newPage(); await pe.goto(base); await ready(pe);
    assert.ok((await pe.locator('#save-status').innerText()).includes('10分'));
    assert.equal(await pe.locator('#confirm').isVisible(),false);
    assert.equal(await zone(pe).isEnabled(),false);
    assert.equal(backend.posts.length,sent);
    console.log('PASS: expired receipt blocks new writes and explicitly reports unknown state');

    // A fresh browser with an unconfirmed create must not claim a successful own sticker.
    const uncertain = await newContext(browser);
    const pc = await uncertain.newPage(); await pc.goto(base); await ready(pc);
    await setShortReceiptTimeout(pc); backend.hold = true;
    await zone(pc,7).click(); await pc.locator('#confirm').click();
    await assertMessage(pc,'保存結果を確認できませんでした');
    assert.equal(await own(pc),null); assert.ok(await pending(pc));
    const postsAfterCreate = backend.posts.length;
    const sibling = await uncertain.newPage(); await sibling.goto(base); await ready(sibling);
    assert.equal(await zone(sibling).isEnabled(),false);
    backend.hold = false; await pc.locator('#receipt-retry').click();
    // Either tab may own the receipt lock; the other receives the confirmed storage event.
    await pc.waitForFunction(()=>JSON.parse(localStorage.getItem('librarian-sticker-v1')||'null')?.type===7);
    assert.equal(backend.posts.length,postsAfterCreate);
    await sibling.waitForFunction(()=>!!localStorage.getItem('librarian-sticker-v1'));
    assert.equal((await own(sibling)).row,(await own(pc)).row);
    console.log('PASS: fresh create stays unconfirmed, second tab cannot duplicate, storage sync');

    const quota = await newContext(browser);
    await quota.addInitScript(key=>{
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k,v) { if(k===key) throw new DOMException('Test quota','QuotaExceededError'); return set.call(this,k,v); };
    },pendingKey);
    const pq = await quota.newPage(); await pq.goto(base); await ready(pq);
    await zone(pq).click(); await pq.locator('#confirm').click(); await assertMessage(pq,'送信できませんでした');
    assert.equal(backend.posts.length,postsAfterCreate); assert.equal(await own(pq),null);
    console.log('PASS: pending storage failure prevents POST');

    const blocked = await newContext(browser);
    await blocked.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new Error('Test storage blocked');}}));
    const pb = await blocked.newPage(); await pb.goto(base); await ready(pb);
    assert.ok((await pb.locator('#mode-banner').innerText()).includes('閲覧のみ'));
    assert.equal(await zone(pb).isEnabled(),false);
    console.log('PASS: unavailable storage provides read-only UI');

    for (const [width,columns] of [[1440,4],[1024,3],[768,2],[390,1],[320,1]]) {
      await p2.setViewportSize({width,height:900});
      await p2.evaluate(()=>window.scrollTo(0,0));
      const info = await p2.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,columns:getComputedStyle(document.getElementById('board')).gridTemplateColumns.split(' ').length,minZone:Math.min(...[...document.querySelectorAll('.sticker-zone')].map(z=>z.clientWidth))}));
      assert.equal(info.columns,columns); assert.ok(info.scroll<=info.width); assert.ok(info.minZone>=44);
      if (width === 1440 || width === 390) {
        // Load lazy assets before visual QA; a full-page capture alone won't load them.
        for(const image of await p2.locator('.type-image').all()) { await image.scrollIntoViewIfNeeded(); await image.evaluate(img=>img.decode()); }
        await p2.evaluate(()=>window.scrollTo(0,0));
        await p2.screenshot({path:`test-results/${width===1440?'desktop':'mobile'}.png`,fullPage:true});
        await p2.screenshot({path:`test-results/${width===1440?'desktop':'mobile'}-viewport.png`});
      }
    }
    console.log('PASS: responsive 4/3/2/1 columns, 320px without overflow, touch targets');

    const demo = await newContext(browser,{viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    const pd = await demo.newPage(); await pd.goto(base+'?demo=1'); await ready(pd);
    assert.ok((await pd.locator('#mode-banner').innerText()).includes('会場のボードには投稿されません'));
    await pd.locator('[data-shape="heart"]').click(); await pd.locator('[data-color="#ec4899"]').click();
    await zone(pd,2).tap(); await pd.locator('#confirm').tap(); await assertMessage(pd,'デモで貼りました');
    assert.equal(await own(pd),null); assert.equal(backend.posts.length,postsAfterCreate);
    await pd.reload(); await ready(pd); assert.equal(await pd.locator('.is-own').count(),1);
    console.log('PASS: mobile touch, explicit demo, demo isolated from production');

    const unset = await browser.newContext();
    await unset.route('**/config.js',r=>r.fulfill({contentType:'application/javascript',body:'window.STICKER_CONFIG={gasUrl:""}'}));
    const pu = await unset.newPage(); await pu.goto(base); await ready(pu);
    assert.ok((await pu.locator('#mode-banner').innerText()).includes('デモモード'));
    console.log('PASS: missing backend displays demo');
    assert.deepEqual(failures,[]);
    console.log('All browser checks passed. No production writes were made.');
  } finally { await browser.close(); }
})().catch(err=>{console.error(err);process.exitCode=1;});
