import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { conversation, fixtureHTML } from './fixture.mjs';

const playwright = process.env.TOC_PLAYWRIGHT_PATH
  ? await import(pathToFileURL(process.env.TOC_PLAYWRIGHT_PATH).href) : await import('playwright');
const executablePath = process.env.TOC_CHROME_PATH || (existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
const assets = { '/bridge.js': await readFile('dist/bridge.js'), '/content.js': await readFile('dist/content.js') };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (assets[url.pathname]) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(assets[url.pathname]); return; }
  if (url.pathname.startsWith('/backend-api/conversation/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(url.searchParams.has('invalid') ? { changed_schema: true } : conversation(url.pathname.split('/').at(-1), Number(url.searchParams.get('count') || 300))));
    return;
  }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });res.end(fixtureHTML);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
process.stdout.write(`Local fixture: ${base}\nLaunching isolated headless Chrome…\n`);
await mkdir('artifacts', { recursive: true });
const browser = await playwright.chromium.launch({ executablePath, headless: true, timeout: 20_000 });
process.stdout.write('Chrome ready.\n');
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
page.setDefaultTimeout(10_000);
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const host = page.locator('#chatgpt-toc-extension');
const status = host.locator('.status');
const results = [];
async function test(name, fn) {
  await fn(); results.push({ name, passed: true }); process.stdout.write(`PASS ${name}\n`);
}
async function textIncludes(locator, text, timeout = 10_000) {
  await locator.filter({ hasText: text }).waitFor({ state: 'visible', timeout });
}
async function open() {
  await host.locator('.handle').focus();
  await host.locator('.handle').press('Enter');
  await host.locator('.panel').waitFor({ state: 'visible' });
}
async function go(path) { await page.goto(base + path); await host.waitFor({ state: 'attached' }); await open(); }
async function jump(id) {
  // Selecting an item programmatically on this local harness avoids scrolling the
  // ChatGPT fixture while exposing a distant virtualized row through the UI.
  await page.evaluate(id => {
    const root=document.querySelector('#chatgpt-toc-extension').shadowRoot;
    const count=Number(root.querySelector('header span').textContent.match(/\d+/)[0]);
    const order=Number(id.split('-').at(-1));
    root.querySelector('.list').scrollTop=Math.min(count-1,order)*38;
  }, id);
  await host.locator(`.row[data-message-id="${id}"]`).click();
  await textIncludes(status, '已定位', 15_000);
  const result = await page.evaluate(id => {
    const e=document.querySelector(`[data-chatgpt-search-message-ids="${id}"], [data-message-id="${id}"]`);
    const s=document.querySelector('#active-main .thread-scroll-container');
    return e && { top:e.getBoundingClientRect().top-s.getBoundingClientRect().top, bottom:e.getBoundingClientRect().bottom-s.getBoundingClientRect().top, height:s.clientHeight, atBottom:s.scrollTop+s.clientHeight>=s.scrollHeight-2 };
  }, id);
  assert.ok(result && result.bottom > 0 && result.top < result.height, `target visible: ${id} ${JSON.stringify(result)}`);
  assert.ok(Math.abs(result.top - 84) < 18 || result.top >= 0 && (result.top < 180 || result.atBottom), `target aligned: ${JSON.stringify(result)}`);
}

try {
  await test('300 提问完整分支目录、隐藏会话隔离、虚拟化行数', async () => {
    await go('/c/test-a?count=300');
    await textIncludes(status, '完整加载');
    assert.match(await host.locator('header').textContent(), /300/);
    assert.ok(await host.locator('.row').count() <= 21);
    assert.ok(!(await host.textContent()).includes('其他会话的秘密提问'));
    assert.ok(!(await host.textContent()).includes('不应出现的旧分支'));
  });
  await test('虚拟化首、中、末消息跳转与精确定位', async () => {
    for (const i of [0, 149, 299, 80]) await jump(`test-a-u-${i}`);
  });
  await test('回答区域阅读仍高亮所属提问', async () => {
    await page.evaluate(() => window.fixture.scrollAnswer(80));
    await page.waitForTimeout(350);
    await host.locator('.row[data-message-id="test-a-u-80"][aria-current="location"]').waitFor();
  });
  await test('相同提问保留两个条目、目录文本不执行 HTML', async () => {
    await jump('test-a-u-3');
    assert.equal(await host.locator('.row').filter({ hasText: '重复的问题' }).count(), 2);
    await jump('test-a-u-11');
    assert.equal(await page.evaluate(() => window.injected), undefined);
    assert.equal(await host.locator('.row img').count(), 0);
  });
  await test('深色主题、窄窗口及折叠展开', async () => {
    await jump('test-a-u-149');
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.waitForTimeout(100);
    assert.equal(await host.getAttribute('data-theme'), 'dark');
    await page.screenshot({ path: 'artifacts/dark.png' });
    await host.locator('.close').click();
    await host.locator('.panel').waitFor({ state: 'hidden' });
    await open();
    await page.setViewportSize({ width: 540, height: 820 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'artifacts/narrow.png' });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await jump('test-a-u-149');
    await page.screenshot({ path: 'artifacts/preview.png' });
  });
  await test('新提问自动加入与 SPA 会话切换', async () => {
    await page.evaluate(() => window.fixture.append());
    await page.waitForTimeout(400);
    assert.match(await host.locator('header').textContent(), /301/);
    await page.evaluate(() => window.fixture.appendAlone());
    await page.waitForTimeout(400);
    assert.match(await host.locator('header').textContent(), /302/);
    await textIncludes(status, '完整加载');
    await page.evaluate(() => window.fixture.navigate('test-b', 3));
    await page.waitForTimeout(800);
    await textIncludes(status, '完整加载');
    assert.match(await host.locator('header').textContent(), /3 次/);
    assert.equal(await host.locator('.row[data-message-id^="test-a"]').count(), 0);
  });
  await test('新会话数据先于 DOM 到达时，不混入旧会话提问', async () => {
    await page.evaluate(() => { void window.fixture.navigateDelayed('test-delayed', 4); });
    await page.waitForTimeout(400);
    assert.match(await host.locator('header').textContent(), /4 次/);
    assert.equal(await host.locator('.row[data-message-id^="test-b"]').count(), 0);
    await page.waitForTimeout(1000);
    await textIncludes(status, '完整加载');
    assert.match(await host.locator('header').textContent(), /4 次/);
  });
  await test('旧版 DOM 与 XHR JSON 适配', async () => {
    await go('/c/test-old?count=30&old=1&xhr=1');
    await textIncludes(status, '完整加载');
    assert.match(await host.locator('header').textContent(), /30/);
    await jump('test-old-u-0');
    await jump('test-old-u-20');
  });
  await test('编辑产生新分支时，立即移除旧提问后缀', async () => {
    await go('/c/test-edit?count=6&virtual=0');
    await textIncludes(status, '完整加载');
    await page.evaluate(() => window.fixture.replaceBranch());
    await page.waitForTimeout(400);
    await textIncludes(status, '尚未完整加载');
    assert.match(await host.locator('header').textContent(), /2 次/);
    assert.equal(await host.locator('.row[data-message-id="test-edit-u-2"]').count(), 0);
    assert.equal(await host.locator('.row[data-message-id="replacement-id"]').count(), 1);
  });
  await test('接口格式变化时保持部分目录，扫描可补全并恢复锚点', async () => {
    await go('/c/test-scan?count=32&data=0&proof=1');
    await textIncludes(status, '尚未完整加载');
    await page.evaluate(() => window.fixture.scroll(15));
    await page.waitForTimeout(400);
    const initial = await page.evaluate(() => window.fixture.state.scrollTop);
    await host.locator('.action').filter({ hasText: '加载完整目录' }).click();
    await textIncludes(status, '已完整扫描', 20_000);
    assert.match(await host.locator('header').textContent(), /32/);
    const restored = await page.evaluate(() => window.fixture.state.scrollTop);
    assert.ok(Math.abs(initial - restored) < 8, `restore ${initial} -> ${restored}`);
  });
  await test('无明确历史起点时不误报完整', async () => {
    await go('/c/test-unproven?count=8&data=0');
    await host.locator('.action').filter({ hasText: '加载完整目录' }).click();
    await textIncludes(status, '无法确认历史起点', 10_000);
    assert.ok(await host.locator('.action').filter({ hasText: '加载完整目录' }).isVisible());
  });
  await test('扫描取消保留目录，主动滚轮终止定位', async () => {
    await go('/c/test-cancel?count=300&data=0');
    await host.locator('.action').filter({ hasText: '加载完整目录' }).click();
    await host.locator('.action').filter({ hasText: /^取消$/ }).click();
    await textIncludes(status, '已取消');
    assert.ok(Number((await host.locator('header').textContent()).match(/\d+/)[0]) > 0);
    await go('/c/test-wheel?count=300');
    await page.evaluate(() => window.fixture.removeAll());
    await page.evaluate(() => {
      const root=document.querySelector('#chatgpt-toc-extension').shadowRoot;
      root.querySelector('.list').scrollTop=149*38;
    });
    await host.locator('.row[data-message-id="test-wheel-u-149"]').click();
    await page.mouse.move(650, 400); await page.mouse.wheel(0, 300);
    await page.mouse.move(1420, 480); await open();
    await textIncludes(status, '已取消');
  });
  await test('60 秒超时释放任务并提供重试', async () => {
    await go('/c/test-timeout?count=300');
    await page.evaluate(() => window.fixture.removeAll());
    await page.clock.install();
    await page.evaluate(() => {
      const root=document.querySelector('#chatgpt-toc-extension').shadowRoot;
      root.querySelector('.list').scrollTop=149*38;
    });
    await host.locator('.row[data-message-id="test-timeout-u-149"]').click();
    await page.clock.fastForward(60_100);
    await textIncludes(status, '超时');
    await host.locator('.action').filter({ hasText: '重试跳转' }).waitFor({ state: 'visible' });
    await page.clock.resume();
  });
  assert.deepEqual(errors, [], 'no browser exceptions');
  await writeFile('artifacts/e2e-results.json', JSON.stringify({ browser: await browser.version(), results, errors }, null, 2));
  await rm('artifacts/failure.png', { force: true });
  process.stdout.write(`\n${results.length} browser scenarios passed.\n`);
} catch (error) {
  await page.screenshot({ path: 'artifacts/failure.png' }).catch(() => {});
  await writeFile('artifacts/e2e-results.json', JSON.stringify({ results, errors, failure: String(error) }, null, 2));
  throw error;
} finally {
  await browser.close();
  server.close();
}
