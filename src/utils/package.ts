function resolvePackageJson(): { name: string; version: string } {
  try {
    // Compiled to CommonJS at dist/utils/package.js; package.json lives at the
    // module root (../.. relative to dist/utils).
    const pkg = require('../../package.json');
    return { name: String(pkg?.name ?? 'reqstorm'), version: String(pkg?.version ?? '0.0.0') };
  } catch {
    return { name: 'reqstorm', version: '0.0.0' };
  }
}

const pkg = resolvePackageJson();

export const PACKAGE_NAME = pkg.name;
export const VERSION = pkg.version;
