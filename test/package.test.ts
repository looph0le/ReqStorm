import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PACKAGE_NAME, VERSION } from '../src/utils/package.js';

describe('version metadata', () => {
  it('is sourced from package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
    expect(PACKAGE_NAME).toBe(pkg.name);
    expect(VERSION).toBe(pkg.version);
  });

  it('matches the MCP server version reported in index.ts', () => {
    const index = fs.readFileSync(path.join(process.cwd(), 'src/index.ts'), 'utf-8');
    expect(index).toContain(`version: VERSION`);
  });
});
