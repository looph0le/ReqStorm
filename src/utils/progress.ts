export interface ProgressCtx {
  mcpReq?: {
    _meta?: { progressToken?: string | number };
    notify?: (notification: { method: string; params: Record<string, unknown> }) => Promise<void>;
  };
}

export function reportProgress(
  ctx: ProgressCtx | undefined,
  progress: number,
  total?: number,
  message?: string
): Promise<void> {
  const token = ctx?.mcpReq?._meta?.progressToken;
  const notify = ctx?.mcpReq?.notify;
  if (token === undefined || notify === undefined || progress <= 0) {
    return Promise.resolve();
  }
  const params: Record<string, unknown> = {
    progressToken: token,
    progress,
  };
  if (total !== undefined && total > 0) params.total = total;
  if (message !== undefined) params.message = message;
  return notify({ method: 'notifications/progress', params }).catch(() => {});
}
