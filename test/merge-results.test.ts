import { describe, it, expect } from 'vitest';
import type { Result as AutocannonResult, Histogram } from 'autocannon';
import { mergeResults } from '../src/utils/autocannon.js';

function hist(overrides: Partial<Histogram> = {}): Histogram {
  return {
    total: 0,
    average: 0,
    mean: 0,
    stddev: 0,
    min: 0,
    max: 0,
    p0_001: 0,
    p0_01: 0,
    p0_1: 0,
    p1: 0,
    p2_5: 0,
    p10: 0,
    p25: 0,
    p50: 0,
    p75: 0,
    p90: 0,
    p97_5: 0,
    p99: 0,
    p99_9: 0,
    p99_99: 0,
    p99_999: 0,
    ...overrides,
  };
}

function result(overrides: Partial<AutocannonResult> = {}): AutocannonResult {
  return {
    title: 't',
    url: 'http://localhost',
    socketPath: undefined,
    requests: { ...hist({ total: 100, average: 10 }), sent: 100 },
    latency: hist({ p50: 5, p97_5: 10, p99: 12, p99_9: 20 }),
    throughput: hist({ average: 100 }),
    duration: 10,
    errors: 0,
    timeouts: 0,
    start: new Date(),
    finish: new Date(),
    connections: 10,
    pipelining: 1,
    non2xx: 0,
    '1xx': 0,
    '2xx': 100,
    '3xx': 0,
    '4xx': 0,
    '5xx': 0,
    mismatches: 0,
    resets: 0,
    statusCodeStats: {},
    ...overrides,
  };
}

describe('mergeResults', () => {
  it('sums requests, errors and duration', () => {
    const a = result({ requests: { ...hist({ total: 60 }), sent: 60 }, errors: 1 });
    const b = result({ requests: { ...hist({ total: 40 }), sent: 40 }, errors: 2 });
    const merged = mergeResults(a, b);
    expect(merged.requests.total).toBe(100);
    expect(merged.errors).toBe(3);
    expect(merged.duration).toBe(20);
  });

  it('produces request-count-weighted percentiles', () => {
    const a = result({ latency: hist({ p50: 100 }) });
    const b = result({ latency: hist({ p50: 200 }) });
    const merged = mergeResults(a, b);
    expect(merged.latency.p50).toBe(150); // 50/50 split
  });

  it('handles zero total requests without NaN', () => {
    const a = result({ requests: { ...hist({ total: 0 }), sent: 0 }, latency: hist({ p50: 10 }) });
    const b = result({ requests: { ...hist({ total: 0 }), sent: 0 }, latency: hist({ p50: 20 }) });
    const merged = mergeResults(a, b);
    expect(merged.requests.average).toBe(0);
  });
});
