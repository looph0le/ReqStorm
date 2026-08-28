export interface RequestConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface Thresholds {
  maxP95?: number;
  maxP99?: number;
  maxErrorRate?: number;
}

export interface LatencyPercentiles {
  p50: number;
  p95: number;
  p99: number;
  p999: number;
}

export interface BenchmarkResult {
  title: string;
  url: string;
  method: string;
  duration: number;
  connections: number;
  pipelining: number;
  totalRequests: number;
  totalErrors: number;
  errorRate: number;
  throughput: number;
  latency: LatencyPercentiles;
  ttfb: LatencyPercentiles;
  warmUp?: PhaseResult;
  steadyState?: PhaseResult;
}

export interface PhaseResult {
  label: string;
  duration: number;
  totalRequests: number;
  totalErrors: number;
  errorRate: number;
  throughput: number;
  latency: LatencyPercentiles;
  ttfb: LatencyPercentiles;
}

export interface SmokeResult {
  url: string;
  method: string;
  statusCode: number;
  duration: number;
  responseTime: number;
  latency: LatencyPercentiles;
  expectedStatusMet?: boolean;
  expectedBodyMet?: boolean;
  pass: boolean;
  errors: string[];
}

export interface ThresholdResult {
  name: string;
  threshold: number;
  actual: number;
  passed: boolean;
}

export interface LoadTestResult extends BenchmarkResult {
  thresholds: ThresholdResult[];
  passed: boolean;
}

export interface SpikeResult {
  url: string;
  method: string;
  baseline: PhaseResult;
  spike: PhaseResult;
  recovery: PhaseResult;
  recoveryTimeMs: number;
  recovered: boolean;
  degradationRatio: number;
}

export interface SoakResult {
  url: string;
  method: string;
  duration: number;
  connections: number;
  snapshots: SoakSnapshot[];
  finalLatencyDrift: number;
  finalErrorRateDrift: number;
  memoryTrend: "stable" | "growing" | "unknown";
  passed: boolean;
}

export interface SoakSnapshot {
  timestamp: number;
  elapsed: number;
  latency: LatencyPercentiles;
  throughput: number;
  errorRate: number;
}

export interface StressStep {
  concurrency: number;
  latency: LatencyPercentiles;
  throughput: number;
  errorRate: number;
}

export interface StressTestResult {
  url: string;
  method: string;
  steps: StressStep[];
  breakingPoint: number | null;
  breakingConcurrency: number | null;
  maxThroughput: number;
  maxThroughputConcurrency: number;
}

export interface CompareResult {
  baseline: BenchmarkResult;
  target: BenchmarkResult;
  deltas: {
    p50: number;
    p95: number;
    p99: number;
    throughput: number;
    errorRate: number;
  };
  verdict: string;
}
