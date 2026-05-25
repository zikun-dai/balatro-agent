export interface ToolErrorEnvelope {
  content: [{ type: "text"; text: string }];
  structuredContent: {
    error_code: string;
    message: string;
    [key: string]: unknown;
  };
  isError: true;
}

export function toolError(
  errorCode: string,
  message: string,
  details?: Record<string, unknown>,
): ToolErrorEnvelope {
  const structuredContent = {
    error_code: errorCode,
    message,
    ...(details ?? {}),
  };

  const text = JSON.stringify(structuredContent, null, 2);

  return {
    content: [{ type: "text", text }],
    structuredContent,
    isError: true,
  };
}
