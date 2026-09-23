import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveResult, loadResult, listResults, deleteResult } from '../src/utils/persistence.js';

const originalCwd = process.cwd();
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reqstorm-test-'));
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('persistence', () => {
  it('round-trips save/load', () => {
    saveResult('bench', 'benchmark', { p95: 12.5, throughput: 100 });
    const loaded = loadResult('bench');
    expect(loaded).not.toBeNull();
    expect(loaded!.tool).toBe('benchmark');
    expect(loaded!.data).toEqual({ p95: 12.5, throughput: 100 });
    expect(loaded!.timestamp).toBeDefined();
  });

  it('returns null for missing results', () => {
    expect(loadResult('definitely-not-saved')).toBeNull();
  });

  it('sanitizes unsafe names', () => {
    saveResult('foo/../bar baz', 'benchmark', {});
    expect(loadResult('foo/../bar baz')).not.toBeNull();
    expect(fs.existsSync(path.join(tmpDir, '.reqstorm', 'foo_.._bar_baz.json'))).toBe(true);
  });

  it('lists results newest-first', async () => {
    saveResult('older', 'benchmark', {});
    await new Promise((r) => setTimeout(r, 15));
    saveResult('newer', 'benchmark', {});
    const list = listResults();
    expect(list.map((r) => r.name)).toEqual(['newer', 'older']);
  });

  it('deletes results', () => {
    saveResult('to-delete', 'benchmark', {});
    expect(deleteResult('to-delete')).toBe(true);
    expect(deleteResult('to-delete')).toBe(false);
    expect(loadResult('to-delete')).toBeNull();
  });

  it('tolerates corrupt files when listing', () => {
    fs.mkdirSync(path.join(tmpDir, '.reqstorm'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.reqstorm', 'corrupt.json'), '{not json');
    saveResult('good', 'benchmark', {});
    const list = listResults();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('good');
  });
});
