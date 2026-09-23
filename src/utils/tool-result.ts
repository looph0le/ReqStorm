export type ToolMessage = {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  structuredContent: object;
  isError?: boolean;
};

export function toolResult(text: string, data: object): ToolMessage {
  return {
    content: [{ type: 'text', text }],
    structuredContent: data,
  };
}

export function toolError(text: string): ToolMessage {
  return {
    content: [{ type: 'text', text }],
    structuredContent: { error: text },
    isError: true,
  };
}
