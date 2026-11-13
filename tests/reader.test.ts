import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import iconv from 'iconv-lite';
import { decodeText, readBook, ReaderSession, sanitizeState } from '../src/reader';

test('UTF-8, BOM, GBK and CRLF decode without changing the source', () => {
  const text = '第一段：你好，世界。\n第二段继续阅读。';
  assert.equal(decodeText(Buffer.from(text)).text, text);
  assert.equal(decodeText(Buffer.from('\uFEFF' + text)).text, text);
  assert.equal(decodeText(iconv.encode(text, 'gbk')).text, text);
  assert.equal(decodeText(Buffer.from(text.replaceAll('\n', '\r\n'))).text, text);
  assert.equal(decodeText(iconv.encode(text, 'gbk')).encoding, 'GBK');
});

test('empty, binary and invalid encoded content is rejected', () => {
  for (const bytes of [Buffer.from(' \n\t'), Buffer.from([0, 1, 2]), Buffer.from([0xff])]) {
    assert.throws(() => decodeText(bytes));
  }
});

test('invalid saved values fall back to safe settings', () => {
  assert.equal(sanitizeState(null).fontSize, 20);
  assert.deepEqual(sanitizeState({ file: 8, fontSize: Infinity, anchor: null }), {
    file: null, fontSize: 20, anchor: { offset: 0, inset: 0 },
  });
  assert.equal(sanitizeState({ fontSize: 100, anchor: { offset: -5, inset: NaN } }).fontSize, 32);
  assert.equal(sanitizeState({ fontSize: 3 }).fontSize, 14);
});

test('directories, oversized files and unavailable state storage fail explicitly', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zread-errors-'));
  try {
    const oversized = path.join(directory, 'large.txt');
    fs.writeFileSync(oversized, '');
    fs.truncateSync(oversized, 50 * 1024 * 1024 + 1);
    assert.throws(() => readBook(oversized), /50 MB/);
    const subdirectory = path.join(directory, 'folder.txt');
    fs.mkdirSync(subdirectory);
    assert.throws(() => readBook(subdirectory), /无法读取/);
    const blocked = path.join(directory, 'blocked');
    fs.writeFileSync(blocked, 'not a directory');
    const session = new ReaderSession(path.join(blocked, 'state.json'));
    assert.throws(() => session.save(session.state));
    assert.equal(fs.readFileSync(blocked, 'utf8'), 'not a directory');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('file failures preserve the active book and atomic state roundtrips', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zread-unit-'));
  try {
    const file = path.join(directory, 'book.txt');
    const stateFile = path.join(directory, 'state.json');
    const source = Buffer.from('测试正文\n继续阅读');
    fs.writeFileSync(file, source);
    const session = new ReaderSession(stateFile);
    session.open(file);
    const state = { file, fontSize: 24, anchor: { offset: 5, inset: -4 } };
    session.save(state);
    assert.deepEqual(new ReaderSession(stateFile).state, state);
    assert.equal(fs.existsSync(stateFile + '.tmp'), false);
    assert.throws(() => session.open(path.join(directory, 'missing.txt')));
    assert.throws(() => session.open(path.join(directory, 'bad.epub')));
    const empty = path.join(directory, 'empty.txt');
    fs.writeFileSync(empty, '');
    assert.throws(() => session.open(empty));
    assert.equal(session.currentFile, file);
    assert.throws(() => session.save({ ...state, file: empty }));
    assert.deepEqual(fs.readFileSync(file), source);
    assert.equal(readBook(file).name, 'book.txt');
    fs.writeFileSync(stateFile, '{broken');
    const corrupted = new ReaderSession(stateFile);
    assert.equal(corrupted.state.file, null);
    assert.ok(corrupted.warning);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('recent books retain independent positions, deduplicate and stay removed after autosave', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zread-history-'));
  try {
    const first = path.join(directory, 'first.txt');
    const second = path.join(directory, 'second.txt');
    const stateFile = path.join(directory, 'state.json');
    fs.writeFileSync(first, '甲书正文。'.repeat(200));
    fs.writeFileSync(second, '乙书正文。'.repeat(200));
    let session = new ReaderSession(stateFile);
    session.open(first);
    session.save({ file: first, fontSize: 22, anchor: { offset: 300, inset: -3 }, progress: 30 });
    session.open(second);
    session.save({ file: second, fontSize: 22, anchor: { offset: 600, inset: -5 }, progress: 60 });
    session = new ReaderSession(stateFile);
    assert.deepEqual(session.history.map((entry) => entry.file), [second, first]);
    session.open(first);
    assert.deepEqual(session.state.anchor, { offset: 300, inset: -3 });
    assert.equal(session.history.length, 2);
    assert.equal(session.history[0].file, first);
    session.remove(first);
    session.save({ file: first, fontSize: 22, anchor: { offset: 350, inset: 0 }, progress: 35 });
    session = new ReaderSession(stateFile);
    assert.equal(session.state.file, null);
    assert.deepEqual(session.history.map((entry) => entry.file), [second]);
    assert.equal(session.history[0].anchor.offset, 600);
    session.remove(second);
    assert.deepEqual(new ReaderSession(stateFile).history, []);
    assert.equal(fs.readFileSync(first, 'utf8'), '甲书正文。'.repeat(200));
    assert.equal(fs.readFileSync(second, 'utf8'), '乙书正文。'.repeat(200));
    session.open(first);
    assert.equal(session.state.anchor.offset, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('legacy single-book state migrates and missing files remain removable', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zread-migration-'));
  try {
    const missing = path.join(directory, 'missing.txt');
    const stateFile = path.join(directory, 'state.json');
    fs.writeFileSync(stateFile, JSON.stringify({ file: missing, fontSize: 24, anchor: { offset: 100, inset: -2 } }));
    const session = new ReaderSession(stateFile);
    assert.equal(session.history.length, 1);
    assert.equal(session.history[0].anchor.offset, 100);
    assert.throws(() => session.open(missing));
    assert.equal(session.history.length, 1);
    session.remove(missing);
    assert.equal(new ReaderSession(stateFile).history.length, 0);
    assert.equal(new ReaderSession(stateFile).state.fontSize, 24);
    assert.equal(new ReaderSession(stateFile).state.file, null);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('failed history deletion preserves the in-memory reading record', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zread-history-error-'));
  try {
    const file = path.join(directory, 'book.txt');
    const stateFile = path.join(directory, 'state.json');
    fs.writeFileSync(file, '阅读正文');
    const session = new ReaderSession(stateFile);
    session.open(file);
    session.save(session.state);
    fs.unlinkSync(stateFile);
    fs.mkdirSync(stateFile);
    assert.throws(() => session.remove(file));
    assert.equal(session.history[0].file, file);
    assert.equal(session.state.file, file);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
