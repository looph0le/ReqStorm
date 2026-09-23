import { describe, it, expect, vi } from 'vitest';
import { toolResult, toolError } from '../src/utils/tool-result.js';
import { reportProgress, type ProgressCtx } from '../src/utils/progress.js';
import { matcherSchema } from '../src/utils/matchers.js';

describe('toolResult / toolError', () => {
  it('toolResult wraps data into structuredContent', () => {
    const data = { url: 'http://x', ok: true };
    const r = toolResult('text', data);
    expect(r.content[0].type).toBe('text');
    expect(r.content[0].text).toBe('text');
    expect(r.structuredContent).toBe(data);
    expect(r.isError).toBeUndefined();
  });

  it('toolError sets isError and structuredContent.error', () => {
    const r = toolError('boom');
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe('boom');
    expect(r.structuredContent).toEqual({ error: 'boom' });
  });

  it('result objects are assignable to the SDK CallToolResult index-signature shape', () => {
    const data = toolResult('x', { a: 1 });
    const withIndexSignature: { [key: string]: unknown } = data;
    expect(withIndexSignature.structuredContent).toEqual({ a: 1 });
  });
});

describe('reportProgress', () => {
  it('no-ops without a context', async () => {
    await expect(reportProgress(undefined, 1)).resolves.toBeUndefined();
  });

  it('no-ops without a progress token', async () => {
    const notify = vi.fn();
    await reportProgress({ mcpReq: { notify } }, 5, 10);
    expect(notify).not.toHaveBeenCalled();
  });

  it('no-ops without a notify function', async () => {
    await reportProgress({ mcpReq: { _meta: { progressToken: 'tk' } } }, 5, 10);
  });

  it('skips non-positive progress', async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const ctx: ProgressCtx = { mcpReq: { _meta: { progressToken: 'tk' }, notify } };
    await reportProgress(ctx, 0, 10);
    await reportProgress(ctx, -1, 10);
    expect(notify).not.toHaveBeenCalled();
  });

  it('sends a progress notification with token, progress, total, and message', async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const ctx: ProgressCtx = {
      mcpReq: { _meta: { progressToken: 'tk-1' }, notify },
    };
    await reportProgress(ctx, 4, 10, 'quarter');
    expect(notify).toHaveBeenCalledWith({
      method: 'notifications/progress',
      params: { progressToken: 'tk-1', progress: 4, total: 10, message: 'quarter' },
    });
  });

  it('omits total/message when not provided', async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const ctx: ProgressCtx = {
      mcpReq: { _meta: { progressToken: 'tk' }, notify },
    };
    await reportProgress(ctx, 1);
    expect(notify).toHaveBeenCalledWith({
      method: 'notifications/progress',
      params: { progressToken: 'tk', progress: 1 },
    });
  });

  it('swallows notify rejection', async () => {
    const notify = vi.fn().mockRejectedValue(new Error('disc'));
    const ctx: ProgressCtx = {
      mcpReq: { _meta: { progressToken: 'tk' }, notify },
    };
    await expect(reportProgress(ctx, 1)).resolves.toBeUndefined();
  });
});

describe('matcherSchema', () => {
  it('accepts ops that need no extra fields', () => {
    expect(matcherSchema.parse({ op: 'exists' })).toEqual({ op: 'exists' });
    expect(matcherSchema.parse({ op: 'notExists' })).toEqual({ op: 'notExists' });
    expect(matcherSchema.parse({ op: 'isArray' })).toEqual({ op: 'isArray' });
  });

  it('accepts equals/notEquals with expected', () => {
    expect(matcherSchema.parse({ op: 'equals', expected: 5 }).expected).toBe(5);
    expect(matcherSchema.parse({ op: 'notEquals', expected: 'x' }).expected).toBe('x');
  });

  it('rejects equals/gt/lt/isType/hasLength without expected', () => {
    for (const op of [
      'equals',
      'notEquals',
      'contains',
      'gt',
      'lt',
      'gte',
      'lte',
      'isType',
      'hasLength',
    ]) {
      const r = matcherSchema.safeParse({ op });
      expect(r.success).toBe(false);
      expect(r.success ? '' : r.error.issues[0].path).toEqual(['expected']);
    }
  });

  it('rejects matches without pattern and accepts it with', () => {
    const bad = matcherSchema.safeParse({ op: 'matches', expected: 'a' });
    expect(bad.success).toBe(false);
    expect(bad.success ? '' : bad.error.issues[0].path).toEqual(['pattern']);
    expect(matcherSchema.parse({ op: 'matches', pattern: '^x$' }).pattern).toBe('^x$');
  });

  it('passes through expected on ops that do not require it', () => {
    expect(matcherSchema.parse({ op: 'exists', expected: 'ignored' }).expected).toBe('ignored');
  });
});
