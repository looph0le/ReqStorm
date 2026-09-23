import { describe, it, expect } from 'vitest';
import { extractVariables, interpolate, flattenVariables } from '../src/utils/variables.js';

describe('extractVariables', () => {
  it('extracts via JSONPath from a parsed object', () => {
    const doc = { id: 42, user: { name: 'ada' }, tags: ['a', 'b'] };
    const vars = extractVariables(doc, {
      userId: '$.id',
      name: '$.user.name',
      firstTag: '$.tags[0]',
    });
    expect(vars).toEqual({ userId: 42, name: 'ada', firstTag: 'a' });
  });

  it('extracts from a JSON string body', () => {
    const vars = extractVariables('{"a":1}', { a: '$.a' });
    expect(vars).toEqual({ a: 1 });
  });

  it('skips missing paths', () => {
    const vars = extractVariables({ a: 1 }, { missing: '$.nope' });
    expect(vars).toEqual({});
  });
});

describe('interpolate', () => {
  it('replaces {{var}} tokens with string values', () => {
    expect(interpolate('/users/{{id}}', { id: 7 })).toBe('/users/7');
  });

  it('supports dotted lookup', () => {
    expect(interpolate('{{user.name}}', { user: { name: 'ada' } })).toBe('ada');
  });

  it('stringifies non-string values', () => {
    expect(interpolate('{"id":{{id}}}', { id: 7 })).toBe('{"id":7}');
    expect(interpolate('{{obj}}', { obj: { a: 1 } })).toBe('{"a":1}');
  });

  it('leaves unknown tokens untouched', () => {
    expect(interpolate('a {{unknown}} b', { known: 1 })).toBe('a {{unknown}} b');
  });
});

describe('flattenVariables', () => {
  it('keeps strings, stringifies the rest', () => {
    const out = flattenVariables({ s: 'x', n: 1, o: { a: 1 } });
    expect(out).toEqual({ s: 'x', n: '1', o: '{"a":1}' });
  });
});
