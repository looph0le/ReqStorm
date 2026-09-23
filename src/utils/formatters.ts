import type {
  BenchmarkResult,
  LatencyPercentiles,
  PhaseResult,
  SmokeResult,
  ThresholdResult,
  LoadTestResult,
  SpikeResult,
  SoakResult,
  SoakSnapshot,
  StressStep,
  StressTestResult,
  CompareResult,
} from './types.js';

const SEPARATOR = '═'.repeat(50);

function pad(n: string, width: number): string {
  return n.padStart(width);
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function formatMs(ms: number): string {
  return `${ms.toFixed(1)}ms`;
}

function formatPercent(n: number): string {
  return `${n.toFixed(2)}%`;
}

function formatLatencyBlock(label: string, lat: LatencyPercentiles, indent: string = ''): string {
  return [
    `${indent}${label}:`,
    `${indent}  p50: ${formatMs(lat.p50)} | p95: ${formatMs(lat.p95)} | p99: ${formatMs(lat.p99)} | p999: ${formatMs(lat.p999)}`,
  ].join('\n');
}

function formatPhaseResult(phase: PhaseResult, indent: string = ''): string {
  const lines = [
    `${indent}${phase.label} (${phase.duration}s):`,
    `${indent}  Requests:    ${formatNumber(phase.totalRequests)}`,
    `${indent}  p50: ${formatMs(phase.latency.p50)} | p95: ${formatMs(phase.latency.p95)} | p99: ${formatMs(phase.latency.p99)}`,
    `${indent}  Throughput:  ${formatNumber(Math.round(phase.throughput))} req/s | Errors: ${phase.totalErrors} (${formatPercent(phase.errorRate)})`,
  ];
  return lines.join('\n');
}

export function formatBenchmark(result: BenchmarkResult): string {
  const lines = [
    '',
    SEPARATOR,
    `  Benchmark: ${result.method} ${result.url}`,
    SEPARATOR,
    '',
    `Duration:        ${result.duration}s`,
    `Connections:     ${result.connections}`,
    `Pipelining:      ${result.pipelining}`,
    `Total Requests:  ${formatNumber(result.totalRequests)}`,
    '',
  ];

  if (result.warmUp && result.steadyState) {
    lines.push(formatPhaseResult(result.warmUp, '  '));
    lines.push('');
    lines.push(formatPhaseResult(result.steadyState, '  '));
    lines.push('');
    lines.push('Overall:');
  }

  lines.push(formatLatencyBlock('  Latency (ms)', result.latency, '  '));
  lines.push('');
  lines.push(`  Throughput:    ${formatNumber(Math.round(result.throughput))} req/s`);
  lines.push(`  Errors:        ${result.totalErrors} (${formatPercent(result.errorRate)})`);
  lines.push('');

  return lines.join('\n');
}

export function formatSmoke(result: SmokeResult): string {
  const lines = [
    '',
    SEPARATOR,
    `  Smoke Test: ${result.method} ${result.url}`,
    SEPARATOR,
    '',
    `Status Code:     ${result.statusCode}`,
    `Response Time:   ${formatMs(result.responseTime)}`,
    '',
  ];

  if (result.latency.p50 > 0) {
    lines.push(formatLatencyBlock('  Latency (ms)', result.latency, '  '));
    lines.push('');
  }

  const checks: string[] = [];
  if (result.expectedStatusMet !== undefined) {
    checks.push(`  Status check:   ${result.expectedStatusMet ? 'PASS' : 'FAIL'}`);
  }
  if (result.expectedBodyMet !== undefined) {
    checks.push(`  Body check:     ${result.expectedBodyMet ? 'PASS' : 'FAIL'}`);
  }

  if (checks.length > 0) {
    lines.push(...checks);
    lines.push('');
  }

  lines.push(`  Result:         ${result.pass ? 'PASS' : 'FAIL'}`);

  if (result.errors.length > 0) {
    lines.push('');
    lines.push('  Errors:');
    for (const err of result.errors) {
      lines.push(`    - ${err}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

export function formatThresholds(thresholds: ThresholdResult[]): string {
  if (thresholds.length === 0) return '';

  const lines = ['  Thresholds:'];
  for (const t of thresholds) {
    const status = t.passed ? 'PASS' : 'FAIL';
    lines.push(`    ${t.name}: ${t.actual.toFixed(2)} (limit: ${t.threshold}) → ${status}`);
  }
  return lines.join('\n');
}

export function formatLoadTest(result: LoadTestResult): string {
  const lines = [
    '',
    SEPARATOR,
    `  Load Test: ${result.method} ${result.url}`,
    SEPARATOR,
    '',
    `Duration:        ${result.duration}s`,
    `Connections:     ${result.connections}`,
    `Total Requests:  ${formatNumber(result.totalRequests)}`,
    '',
  ];

  if (result.warmUp && result.steadyState) {
    lines.push(formatPhaseResult(result.warmUp, '  '));
    lines.push('');
    lines.push(formatPhaseResult(result.steadyState, '  '));
    lines.push('');
    lines.push('Overall (steady-state evaluated):');
  }

  lines.push(formatLatencyBlock('  Latency (ms)', result.latency, '  '));
  lines.push('');
  lines.push(`  Throughput:    ${formatNumber(Math.round(result.throughput))} req/s`);
  lines.push(`  Errors:        ${result.totalErrors} (${formatPercent(result.errorRate)})`);
  lines.push('');
  lines.push(formatThresholds(result.thresholds));
  lines.push('');
  lines.push(`  Verdict:       ${result.passed ? 'PASS' : 'FAIL'}`);
  lines.push('');

  return lines.join('\n');
}

export function formatSpike(result: SpikeResult): string {
  const lines = [
    '',
    SEPARATOR,
    `  Spike Test: ${result.method} ${result.url}`,
    SEPARATOR,
    '',
    formatPhaseResult(result.baseline, '  '),
    '',
    formatPhaseResult(result.spike, '  '),
    '',
    formatPhaseResult(result.recovery, '  '),
    '',
    `  Recovery Time:    ${formatMs(result.recoveryTimeMs)}`,
    `  Degradation:      ${result.degradationRatio.toFixed(2)}x`,
    `  Recovered:        ${result.recovered ? 'YES' : 'NO'}`,
    '',
  ];

  return lines.join('\n');
}

function formatSnapshot(snap: SoakSnapshot, index: number): string {
  return [
    `  [${index}] ${snap.elapsed}s — p50: ${formatMs(snap.latency.p50)} | p95: ${formatMs(snap.latency.p95)} | p99: ${formatMs(snap.latency.p99)} | ${formatNumber(Math.round(snap.throughput))} req/s | errors: ${formatPercent(snap.errorRate)} | heap: ${snap.heapUsedMb}MB`,
  ].join('\n');
}

export function formatSoak(result: SoakResult): string {
  const lines = [
    '',
    SEPARATOR,
    `  Soak Test: ${result.method} ${result.url}`,
    SEPARATOR,
    '',
    `Duration:          ${result.duration}s`,
    `Connections:       ${result.connections}`,
    `Snapshots:         ${result.snapshots.length}`,
    '',
    '  Periodic Snapshots:',
  ];

  for (let i = 0; i < result.snapshots.length; i++) {
    lines.push(formatSnapshot(result.snapshots[i], i));
  }

  const firstSnap = result.snapshots[0];
  const lastSnap = result.snapshots[result.snapshots.length - 1];

  lines.push('');
  if (firstSnap && lastSnap) {
    lines.push(
      `  Memory:           ${firstSnap.heapUsedMb}MB → ${lastSnap.heapUsedMb}MB heap, ${firstSnap.rssMb}MB → ${lastSnap.rssMb}MB RSS`
    );
  }
  lines.push(`  Latency Drift:    ${formatPercent(result.finalLatencyDrift)}`);
  lines.push(`  Error Rate Drift: ${formatPercent(result.finalErrorRateDrift)}`);
  lines.push(`  Memory Trend:     ${result.memoryTrend}`);
  lines.push('');
  lines.push(`  Verdict:          ${result.passed ? 'PASS' : 'FAIL'}`);
  lines.push('');

  return lines.join('\n');
}

function formatStressStep(step: StressStep, index: number): string {
  return `  ${pad(String(step.concurrency), 4)} conns │ p50: ${pad(formatMs(step.latency.p50), 8)} │ p95: ${pad(formatMs(step.latency.p95), 8)} │ p99: ${pad(formatMs(step.latency.p99), 8)} │ ${pad(formatNumber(Math.round(step.throughput)), 7)} req/s │ errors: ${formatPercent(step.errorRate)}`;
}

export function formatStressTest(result: StressTestResult): string {
  const lines = ['', SEPARATOR, `  Stress Test: ${result.method} ${result.url}`, SEPARATOR, ''];

  lines.push('  Conns │ p50       │ p95       │ p99       │ Req/s   │ Errors');
  lines.push('  ──────┼───────────┼───────────┼───────────┼─────────┼────────');

  for (let i = 0; i < result.steps.length; i++) {
    lines.push(formatStressStep(result.steps[i], i));
  }

  lines.push('');
  lines.push(
    `  Max Throughput:     ${formatNumber(Math.round(result.maxThroughput))} req/s at ${result.maxThroughputConcurrency} conns`
  );

  if (result.breakingConcurrency !== null) {
    lines.push(`  Breaking Point:     ${result.breakingConcurrency} conns`);
  } else {
    lines.push(`  Breaking Point:     Not found (reached max concurrency)`);
  }

  lines.push('');
  return lines.join('\n');
}

export function formatCompare(result: CompareResult): string {
  const fmt = (n: number) => (n > 0 ? `+${n.toFixed(1)}%` : `${n.toFixed(1)}%`);

  const lines = [
    '',
    SEPARATOR,
    `  A/B Comparison${result.runs && result.runs > 1 ? ` (${result.runs} runs)` : ''}`,
    SEPARATOR,
    '',
    `  Baseline: ${result.baseline.method} ${result.baseline.url}`,
    `  Target:   ${result.target.method} ${result.target.url}`,
    '',
    `                    Baseline        Target          Delta`,
    `  ─────────────────────────────────────────────────────────`,
    `  p50:              ${pad(formatMs(result.baseline.latency.p50), 14)}${pad(formatMs(result.target.latency.p50), 14)}${pad(fmt(result.deltas.p50), 12)}`,
    `  p95:              ${pad(formatMs(result.baseline.latency.p95), 14)}${pad(formatMs(result.target.latency.p95), 14)}${pad(fmt(result.deltas.p95), 12)}`,
    `  p99:              ${pad(formatMs(result.baseline.latency.p99), 14)}${pad(formatMs(result.target.latency.p99), 14)}${pad(fmt(result.deltas.p99), 12)}`,
    `  Throughput:       ${pad(formatNumber(Math.round(result.baseline.throughput)) + ' req/s', 14)}${pad(formatNumber(Math.round(result.target.throughput)) + ' req/s', 14)}${pad(fmt(result.deltas.throughput), 12)}`,
    `  Error Rate:       ${pad(formatPercent(result.baseline.errorRate), 14)}${pad(formatPercent(result.target.errorRate), 14)}${pad(fmt(result.deltas.errorRate), 12)}`,
    '',
    `  Verdict: ${result.verdict}`,
  ];

  if (
    result.runs &&
    result.runs > 1 &&
    result.meanP95Baseline !== undefined &&
    result.meanP95Target !== undefined
  ) {
    lines.push('');
    lines.push('  Statistical Confidence:');
    lines.push(
      `    Baseline p95: ${formatMs(result.meanP95Baseline)}${result.sdP95Baseline ? ` ± ${formatMs(result.sdP95Baseline)}` : ''}`
    );
    lines.push(
      `    Target p95:   ${formatMs(result.meanP95Target)}${result.sdP95Target ? ` ± ${formatMs(result.sdP95Target)}` : ''}`
    );
    if (result.confidence !== null && result.confidence !== undefined && result.confidence > 50) {
      lines.push(`    Confidence:   ${result.confidence}%`);
    } else if (result.confidence !== null && result.confidence !== undefined) {
      lines.push(`    Confidence:   insufficient (${result.confidence}%)`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
