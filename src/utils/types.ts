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
  runs?: number;
  confidence?: number | null;
  meanP95Baseline?: number;
  meanP95Target?: number;
  sdP95Baseline?: number;
  sdP95Target?: number;
}

export interface ValidationAssertion {
  path: string;
  actual: unknown;
  matched: boolean;
  message: string;
}

export interface ValidationResult {
  url: string;
  method: string;
  status: number;
  responseTimeMs: number;
  ttfbMs: number;
  assertions: ValidationAssertion[];
  passed: boolean;
  attempts: number;
  errors: string[];
}

export interface ChainStepResult {
  name: string;
  url: string;
  method: string;
  status: number;
  responseTimeMs: number;
  passed: boolean;
  assertions: ValidationAssertion[];
  extracted: Record<string, unknown>;
  error?: string;
}

export interface ChainResult {
  baseUrl: string;
  steps: ChainStepResult[];
  passed: boolean;
  totalSteps: number;
  passedSteps: number;
  finalVariables: Record<string, unknown>;
  errors: string[];
}

export interface EndpointCheck {
  method: string;
  path: string;
  status: number;
  expectedStatus: string;
  schemaPassed: boolean;
  contentTypePassed: boolean;
  statusCodePassed: boolean;
  skipped: boolean;
  skipReason?: string;
}

export interface BreakingChange {
  type: string;
  detail: string;
}

export interface ContractCheckResult {
  specUrl: string;
  baseUrl: string;
  endpointsChecked: number;
  endpointsPassed: number;
  endpointsFailed: number;
  endpointsSkipped: number;
  checks: EndpointCheck[];
  breakingChanges: BreakingChange[];
}

export interface FuzzFinding {
  mutation: string;
  category: string;
  status: number;
  baselineStatus: number;
  issue: string;
}

export interface FuzzResult {
  url: string;
  method: string;
  totalMutations: number;
  baselineStatus: number;
  baselineTimeMs: number;
  passed: number;
  interesting: number;
  failed: number;
  crashes: number;
  timeouts: number;
  findings: FuzzFinding[];
}

export interface ProfileBucket {
  label: string;
  percent: number;
}

export interface StatusCount {
  status: number;
  count: number;
}

export interface ProfileResult {
  url: string;
  method: string;
  duration: number;
  connections: number;
  throughput: number;
  throughputCv: number;
  latency: LatencyPercentiles;
  buckets: ProfileBucket[];
  statusCodes: StatusCount[];
  errors: number;
  timeouts: number;
  mismatches: number;
}

export interface SecurityCheckResult {
  name: string;
  status: "ok" | "warn" | "fail" | "error";
  detail: string;
}

export interface SecurityScanResult {
  url: string;
  method: string;
  checks: SecurityCheckResult[];
  warnings: number;
  critical: number;
  passed: number;
}

export interface RegressionDelta {
  current: number;
  baseline: number;
  changePct: number;
}

export interface RegressionResult {
  url: string;
  method: string;
  deltas: {
    p95: RegressionDelta;
    p99: RegressionDelta;
    throughput: RegressionDelta;
    errorRate: RegressionDelta;
  };
  thresholdsChecked: {
    name: string;
    threshold: number;
    actual: number;
    passed: boolean;
  }[];
  passed: boolean;
  baselineTimestamp: string | null;
  baselineUpdated: boolean;
}

