import { describe, it, expect } from 'vitest';
import { evaluateMatch, isValidType } from '../src/utils/matchers.js';

describe('evaluateMatch', () => {
  it('equals: matches equal primitives', () => {
    expect(evaluateMatch(5, { op: 'equals', expected: 5 }).passed).toBe(true);
    expect(evaluateMatch(5, { op: 'equals', expected: 6 }).passed).toBe(false);
    expect(evaluateMatch(undefined, { op: 'equals', expected: 5 }).passed).toBe(false);
  });

  it('notEquals', () => {
    expect(evaluateMatch(5, { op: 'notEquals', expected: 6 }).passed).toBe(true);
    expect(evaluateMatch(5, { op: 'notEquals', expected: 5 }).passed).toBe(false);
    expect(evaluateMatch(undefined, { op: 'notEquals', expected: 5 }).passed).toBe(true);
  });

  it('contains', () => {
    expect(evaluateMatch('hello world', { op: 'contains', expected: 'world' }).passed).toBe(true);
    expect(evaluateMatch('hello', { op: 'contains', expected: 'x' }).passed).toBe(false);
  });

  it('matches (regex)', () => {
    expect(evaluateMatch('abc123', { op: 'matches', pattern: '^[a-z]+\\d+$' }).passed).toBe(true);
    expect(evaluateMatch('abc', { op: 'matches', pattern: '^\\d+$' }).passed).toBe(false);
    expect(evaluateMatch('x', { op: 'matches', pattern: '(' }).passed).toBe(false);
  });

  it('gt/gte/lt/lte numeric', () => {
    expect(evaluateMatch(10, { op: 'gt', expected: 5 }).passed).toBe(true);
    expect(evaluateMatch(5, { op: 'gt', expected: 5 }).passed).toBe(false);
    expect(evaluateMatch(5, { op: 'gte', expected: 5 }).passed).toBe(true);
    expect(evaluateMatch(4, { op: 'lt', expected: 5 }).passed).toBe(true);
    expect(evaluateMatch(5, { op: 'lt', expected: 5 }).passed).toBe(false);
    expect(evaluateMatch(5, { op: 'lte', expected: 5 }).passed).toBe(true);
    expect(evaluateMatch('abc', { op: 'gt', expected: 1 }).passed).toBe(false);
  });

  it('exists / notExists', () => {
    expect(evaluateMatch(null, { op: 'exists' }).passed).toBe(true);
    expect(evaluateMatch(undefined, { op: 'exists' }).passed).toBe(false);
    expect(evaluateMatch(undefined, { op: 'notExists' }).passed).toBe(true);
  });

  it('isType', () => {
    expect(evaluateMatch('x', { op: 'isType', expected: 'string' }).passed).toBe(true);
    expect(evaluateMatch([1], { op: 'isType', expected: 'array' }).passed).toBe(true);
    expect(evaluateMatch(null, { op: 'isType', expected: 'null' }).passed).toBe(true);
    expect(evaluateMatch(1, { op: 'isType', expected: 'string' }).passed).toBe(false);
  });

  it('isArray', () => {
    expect(evaluateMatch([], { op: 'isArray' }).passed).toBe(true);
    expect(evaluateMatch({}, { op: 'isArray' }).passed).toBe(false);
  });

  it('hasLength for strings/arrays/objects', () => {
    expect(evaluateMatch('abcd', { op: 'hasLength', expected: 4 }).passed).toBe(true);
    expect(evaluateMatch([1, 2], { op: 'hasLength', expected: 2 }).passed).toBe(true);
    expect(evaluateMatch({ a: 1, b: 2 }, { op: 'hasLength', expected: 2 }).passed).toBe(true);
    expect(evaluateMatch(42, { op: 'hasLength', expected: 0 }).passed).toBe(false);
  });

  it('returns a helpful message on failure', () => {
    const r = evaluateMatch('a', { op: 'equals', expected: 'b' });
    expect(r.passed).toBe(false);
    expect(r.message).toContain('got "a"');
  });
});

describe('isValidType', () => {
  it('accepts known types only', () => {
    expect(isValidType('string')).toBe(true);
    expect(isValidType('object')).toBe(true);
    expect(isValidType('nope')).toBe(false);
  });
});
