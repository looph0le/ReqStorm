export type MatcherOp =
  | { op: 'equals'; expected: unknown }
  | { op: 'notEquals'; expected: unknown }
  | { op: 'contains'; expected: string }
  | { op: 'matches'; pattern: string }
  | { op: 'gt'; expected: number }
  | { op: 'lt'; expected: number }
  | { op: 'gte'; expected: number }
  | { op: 'lte'; expected: number }
  | { op: 'exists' }
  | { op: 'notExists' }
  | { op: 'isType'; expected: string }
  | { op: 'isArray' }
  | { op: 'hasLength'; expected: number };

import * as z from 'zod/v4';

const MATCHER_OPS = [
  'equals',
  'notEquals',
  'contains',
  'matches',
  'gt',
  'lt',
  'gte',
  'lte',
  'exists',
  'notExists',
  'isType',
  'isArray',
  'hasLength',
] as const;

const MATCHER_OPS_REQUIRING_EXPECTED: readonly string[] = [
  'equals',
  'notEquals',
  'contains',
  'gt',
  'lt',
  'gte',
  'lte',
  'isType',
  'hasLength',
];

export const matcherSchema = z
  .object({
    op: z.enum(MATCHER_OPS),
    expected: z.any().optional(),
    pattern: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (MATCHER_OPS_REQUIRING_EXPECTED.includes(val.op) && val.expected === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expected'],
        message: `Matcher op "${val.op}" requires an "expected" value`,
      });
    }
    if (val.op === 'matches' && val.pattern === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pattern'],
        message: 'Matcher op "matches" requires a "pattern" string',
      });
    }
  });

export interface MatchResult {
  passed: boolean;
  message: string;
}

const TYPES = ['string', 'number', 'boolean', 'object', 'array', 'null', 'undefined'];

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function describe(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    if (s && s.length > 40) return s.slice(0, 40) + '…';
    return s ?? String(value);
  } catch {
    return String(value);
  }
}

export function evaluateMatch(actual: unknown, matcher: MatcherOp): MatchResult {
  const exists = actual !== undefined && typeOf(actual) !== 'undefined';

  switch (matcher.op) {
    case 'equals':
      return {
        passed: exists && actual === matcher.expected,
        message: `expected ${describe(matcher.expected)}${exists ? `, got ${describe(actual)}` : ', got undefined'}`,
      };
    case 'notEquals':
      return {
        passed: !exists || actual !== matcher.expected,
        message: `expected not equal to ${describe(matcher.expected)}`,
      };
    case 'contains': {
      const str = exists ? String(actual) : '';
      return {
        passed: str.includes(matcher.expected),
        message: `expected to contain "${matcher.expected}"`,
      };
    }
    case 'matches': {
      let ok = false;
      let errMsg = '';
      try {
        const re = new RegExp(matcher.pattern);
        ok = exists && re.test(String(actual));
      } catch (e: any) {
        errMsg = ` (invalid pattern: ${e.message})`;
      }
      return {
        passed: ok,
        message: `expected to match /${matcher.pattern}/${errMsg}`,
      };
    }
    case 'gt':
      return {
        passed: exists && typeof actual === 'number' && actual > matcher.expected,
        message: `expected > ${matcher.expected}${exists ? `, got ${describe(actual)}` : ', got undefined'}`,
      };
    case 'lt':
      return {
        passed: exists && typeof actual === 'number' && actual < matcher.expected,
        message: `expected < ${matcher.expected}${exists ? `, got ${describe(actual)}` : ', got undefined'}`,
      };
    case 'gte':
      return {
        passed: exists && typeof actual === 'number' && actual >= matcher.expected,
        message: `expected >= ${matcher.expected}${exists ? `, got ${describe(actual)}` : ', got undefined'}`,
      };
    case 'lte':
      return {
        passed: exists && typeof actual === 'number' && actual <= matcher.expected,
        message: `expected <= ${matcher.expected}${exists ? `, got ${describe(actual)}` : ', got undefined'}`,
      };
    case 'exists':
      return {
        passed: exists,
        message: `expected value to exist${exists ? '' : `, got ${describe(actual)}`}`,
      };
    case 'notExists':
      return {
        passed: !exists,
        message: `expected value to be absent${exists ? `, got ${describe(actual)}` : ''}`,
      };
    case 'isType': {
      const t = typeOf(actual);
      const ok = exists && t === matcher.expected;
      return {
        passed: ok,
        message: `expected type "${matcher.expected}"${exists ? `, got "${t}"` : ', got undefined'}`,
      };
    }
    case 'isArray':
      return {
        passed: exists && typeOf(actual) === 'array',
        message: `expected an array${exists ? `, got ${describe(actual)}` : ', got undefined'}`,
      };
    case 'hasLength': {
      const len =
        exists &&
        (typeof actual === 'string' ||
          typeOf(actual) === 'array' ||
          (actual !== null && typeof actual === 'object'))
          ? ((actual as any).length ?? Object.keys(actual as any).length)
          : undefined;
      return {
        passed: len !== undefined && len === matcher.expected,
        message: `expected length ${matcher.expected}${len !== undefined ? `, got ${len}` : ', value has no length'}`,
      };
    }
    default:
      return { passed: false, message: `Unknown matcher op` };
  }
}

export function isValidType(t: string): boolean {
  return TYPES.includes(t);
}
