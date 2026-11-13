import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('Windows icon contains valid PNG images for all desktop and taskbar sizes', () => {
  const ico = fs.readFileSync('assets/zread.ico');
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  assert.equal(ico.readUInt16LE(4), sizes.length);
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    assert.equal(ico[entry] || 256, size);
    const offset = ico.readUInt32LE(entry + 12);
    const length = ico.readUInt32LE(entry + 8);
    assert.ok(offset + length <= ico.length);
    assert.equal(ico.subarray(offset, offset + 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(ico.readUInt32BE(offset + 16), size);
    assert.equal(ico.readUInt32BE(offset + 20), size);
  });
});

test('Windows shortcut uses the executable icon and replaces a previous custom icon', { skip: process.platform !== 'win32' }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zread-shortcut-'));
  try {
    // Shortcut construction can be tested without building or launching the application.
    const executable = path.join(directory, 'reader.exe');
    fs.writeFileSync(executable, 'MZ');
    const shortcut = path.join(directory, 'ZRead.lnk');
    const seed = spawnSync('powershell.exe', ['-NoProfile', '-Command',
      '$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:ZREAD_SHORTCUT_TEST); $s.TargetPath=$env:ZREAD_TARGET_TEST; $s.IconLocation="$env:SystemRoot\\system32\\shell32.dll,0"; $s.Save()'],
    { encoding: 'utf8', windowsHide: true, env: { ...process.env, ZREAD_SHORTCUT_TEST: shortcut, ZREAD_TARGET_TEST: executable } });
    assert.equal(seed.status, 0, seed.stderr);
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      'scripts/create-shortcut.ps1', '-ShortcutDirectory', directory, '-ExecutablePath', executable], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.statSync(shortcut).size > 0);
    const inspect = spawnSync('powershell.exe', ['-NoProfile', '-Command',
      '$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:ZREAD_SHORTCUT_TEST); $s | Select-Object TargetPath,WorkingDirectory,IconLocation | ConvertTo-Json -Compress'],
    { encoding: 'utf8', windowsHide: true, env: { ...process.env, ZREAD_SHORTCUT_TEST: shortcut } });
    assert.equal(inspect.status, 0, inspect.stderr);
    const properties = JSON.parse(inspect.stdout);
    const canonical = (file: string) => fs.realpathSync.native(file).toLowerCase();
    assert.equal(canonical(properties.TargetPath), canonical(executable));
    assert.equal(canonical(properties.WorkingDirectory), canonical(path.dirname(executable)));
    assert.ok(properties.IconLocation.endsWith(',0'));
    assert.equal(canonical(properties.IconLocation.slice(0, -2)), canonical(executable));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
