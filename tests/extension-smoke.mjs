import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fixtureHTML, conversation } from './fixture.mjs';
const pw=process.env.TOC_PLAYWRIGHT_PATH
 ? await import(pathToFileURL(process.env.TOC_PLAYWRIGHT_PATH).href) : await import('playwright');
const browser=await pw.chromium.launch({
  executablePath:process.env.TOC_CHROME_PATH || (existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined),
  headless:true, timeout:20_000,
  args:['--enable-unsafe-extension-debugging'], ignoreDefaultArgs:['--disable-extensions'],
});
try {
 const cdp=await browser.newBrowserCDPSession();
 const extension=await cdp.send('Extensions.loadUnpacked',{path:resolve('dist'),enableInIncognito:true});
 console.log('Loaded MV3 extension in a temporary Chrome profile:',extension.id);
 // All requests are fulfilled locally. No ChatGPT login, cookies or user profile.
 const context=await browser.newContext({viewport:{width:1440,height:960}});
 await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.startsWith('/backend-api/conversation/')) await route.fulfill({contentType:'application/json',body:JSON.stringify(conversation(url.pathname.split('/').at(-1),300))});
   else if(url.pathname.startsWith('/c/')) await route.fulfill({contentType:'text/html; charset=utf-8',body:fixtureHTML.replace('<script src="/bridge.js"></script><script src="/content.js"></script>','')});
   else await route.fulfill({status:204,body:''});
 });
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('https://chatgpt.com/c/mv3-test');
 const host=page.locator('#chatgpt-toc-extension');
 await host.waitFor({state:'attached',timeout:10_000});
 await host.locator('.handle').focus();await host.locator('.handle').press('Enter');
 await host.locator('.status').filter({hasText:'完整加载'}).waitFor({state:'visible',timeout:10_000});
 assert.match(await host.locator('header').textContent(),/300/);
 // Verify the application still received its fetch response unchanged.
 assert.equal(await page.evaluate(async()=>{const r=await fetch('/backend-api/conversation/mv3-test');return (await r.json()).current_node}),'mv3-test-a-299');
 await page.waitForTimeout(200);
 await host.locator('.close').click();
 await page.waitForTimeout(150);
 await page.reload();
 await host.locator('.shell.closed').waitFor({state:'attached',timeout:10_000});
 await host.locator('.handle').click();
 await host.locator('.panel').waitFor({state:'visible'});
 await page.keyboard.press('End');
 await host.locator('.row[data-message-id="mv3-test-u-299"]').waitFor();
 assert.deepEqual(errors,[]);
 await mkdir('artifacts',{recursive:true});
 await page.waitForTimeout(250);
 await page.screenshot({path:'artifacts/extension-mv3.png'});
 await writeFile('artifacts/extension-smoke.json',JSON.stringify({passed:true,extensionId:extension.id,browser:await browser.version(),checks:['real MV3 document_start injection','MAIN to ISOLATED snapshot bridge','original response unmodified','chrome.storage.local preference persists','keyboard virtual-list navigation'],network:'all requests intercepted and fulfilled locally',errors},null,2));
 console.log('PASS actual MV3 injection, cross-world bridge, local storage and keyboard navigation.');
} finally {await browser.close()}
