import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import iconv from 'iconv-lite';

let directory: string;
let app: ElectronApplication;
let page: Page;

async function launch() {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  env.ZREAD_TEST_DATA = path.join(directory, 'profile');
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: process.env.ZREAD_EXECUTABLE,
    args: process.env.ZREAD_EXECUTABLE ? [] : ['.'], env,
  });
  page = await app.firstWindow();
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
}
async function choose(file?: string) {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = (async () => ({ canceled: !selected, filePaths: selected ? [selected] : [] })) as typeof dialog.showOpenDialog;
  }, file);
  await page.locator('#open').click();
  await expect(page.locator('#open')).toBeEnabled();
}
async function closeWindow() {
  const exited = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
  await exited;
}
async function savedState() {
  // Use the public persistence API through the periodic timer; verify disk data.
  const file = path.join(directory, 'profile', 'reading-state.json');
  await expect.poll(() => fs.existsSync(file)).toBe(true);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test.beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zread-e2e-'));
  await launch();
});
test.afterEach(async () => {
  if (app?.process().exitCode === null) await app.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('first launch, GBK, safe text rendering, failed opens and cancellation', async () => {
  await expect(page.locator('#startup-help')).toBeHidden();
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#welcome')).toBeVisible();
  await expect(page.locator('#content')).toBeHidden();
  await page.screenshot({ path: 'test-results/welcome.png' });
  const file = path.join(directory, '中文小说.txt');
  const source = iconv.encode('你好，世界。\r\n<script>window.hacked = true</script>\r\n继续阅读', 'gbk');
  fs.writeFileSync(file, source);
  await choose(file);
  await expect(page.locator('#content')).toContainText('你好，世界。');
  await expect(page.locator('#reading-state')).toContainText('GBK');
  expect(await page.evaluate(() => 'hacked' in window)).toBe(false);
  await choose(path.join(directory, 'missing.txt'));
  await expect(page.locator('#notice')).toContainText('无法读取');
  await expect(page.locator('#filename')).toHaveText('中文小说.txt');
  const empty = path.join(directory, 'empty.txt');
  fs.writeFileSync(empty, '');
  await choose(empty);
  await expect(page.locator('#notice')).toContainText('没有可阅读');
  await choose(path.join(directory, 'unsupported.epub'));
  await expect(page.locator('#notice')).toContainText('只支持 TXT');
  await choose();
  await expect(page.locator('#content')).toContainText('继续阅读');
  expect(fs.readFileSync(file).equals(source)).toBe(true);
  await page.screenshot({ path: 'test-results/reading.png' });
});

test('HTML opened without the desktop bridge shows startup help instead of inactive controls', async () => {
  // BrowserWindow without preload reproduces opening HTML in a regular browser.
  for (const file of ['index.html', 'dist/index.html']) {
    const newWindow = app.waitForEvent('window');
    await app.evaluate(async ({ BrowserWindow }, filePath) => {
      const browser = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
      await browser.loadFile(filePath);
    }, path.resolve(file));
    const browserPage = await newWindow;
    await expect(browserPage.locator('#startup-help')).toBeVisible();
    await expect(browserPage.locator('#startup-help')).toContainText('Start-ZRead.cmd');
    await expect(browserPage.locator('#open')).toBeHidden();
    await browserPage.close();
  }
});

test('text position survives font changes, resize, autosave and restart', async () => {
  const file = path.join(directory, '长篇.txt');
  fs.writeFileSync(file, Array.from({ length: 2000 }, (_, i) => `第${i}段：这是阅读位置测试，文字应在调整字号和窗口大小后仍然保持在相同段落附近。`.repeat(3)).join('\n'));
  await choose(file);
  await page.locator('#viewport').evaluate((element) => { element.scrollTop = element.scrollHeight * .47; });
  await page.waitForTimeout(250);
  const before = await page.locator('#viewport').evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    return Array.from(element.querySelectorAll('p')).findIndex((p) => p.getBoundingClientRect().bottom > top);
  });
  await page.locator('#larger').click();
  await page.locator('#larger').click();
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(800, 650); });
  await page.waitForTimeout(350);
  const after = await page.locator('#viewport').evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    return Array.from(element.querySelectorAll('p')).findIndex((p) => p.getBoundingClientRect().bottom > top);
  });
  expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  await expect.poll(async () => (await savedState()).anchor.offset, { timeout: 6000 }).toBeGreaterThan(10000);
  const autosaved = await savedState();
  // Close immediately after another scroll, before the next periodic save.
  await page.locator('#viewport').evaluate((element) => { element.scrollTop += 1500; });
  await page.waitForTimeout(100);
  const closePosition = await page.locator('#viewport').evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    return Array.from(element.querySelectorAll('p')).findIndex((p) => p.getBoundingClientRect().bottom > top);
  });
  await closeWindow();
  const saved = await savedState();
  expect(saved.fontSize).toBe(24);
  expect(saved.anchor.offset).toBeGreaterThan(autosaved.anchor.offset);
  await launch();
  await expect(page.locator('#filename')).toHaveText('长篇.txt');
  await expect(page.locator('#font-size')).toHaveText('24');
  const visible = await page.locator('#viewport').evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    return Array.from(element.querySelectorAll('p')).findIndex((p) => p.getBoundingClientRect().bottom > top);
  });
  expect(Math.abs(visible - closePosition)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: 'test-results/progress-restored.png' });
  await closeWindow();
  fs.unlinkSync(file);
  await launch();
  await expect(page.locator('#notice')).toContainText('无法恢复上次阅读');
  await expect(page.locator('#welcome')).toBeVisible();
  const replacement = path.join(directory, 'new.txt');
  fs.writeFileSync(replacement, '恢复失败后仍然可以打开其他文件。');
  await choose(replacement);
  await expect(page.locator('#content')).toContainText('恢复失败后仍然可以打开其他文件');
});
