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
