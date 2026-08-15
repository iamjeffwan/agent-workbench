import type { ModelCallEvent } from './workbench-data';

export interface ParsedModelCall {
  request: {
    metadata: Record<string, unknown>;
    parameters: Record<string, unknown>;
    systemPrompt: string | null;
    userMessage: {
      title: string | null;
      instructions: string;
    };
    evidence: Record<string, unknown> | null;
  };
  response: {
    metadata: Record<string, unknown>;
    content: string | null;
    reasoning: string | null;
    finishReason: string | null;
    usage: Record<string, unknown> | null;
  };
}

export function parseModelCallEvents(events: ModelCallEvent[]): ParsedModelCall {
  const started = events.find(event => event.event === 'request.started');
  const finished = events.find(event =>
    event.event === 'response.completed' || event.event === 'response.failed');
  const request = asRecord(started?.request);
  const requestBodyText = text(request.body);
  const requestBody = parseJsonRecord(requestBodyText);
  const messages = Array.isArray(requestBody?.messages)
    ? requestBody.messages.map(asRecord)
    : [];
  const systemPrompt = text(messages.find(message => message.role === 'system')?.content);
  const userContent = text(messages.find(message => message.role === 'user')?.content) ?? '';
  const parsedUserMessage = parseTaskUserMessage(userContent);
  const parameters = requestBody ? { ...requestBody } : {};
  delete parameters.messages;

  const response = asRecord(finished?.response);
  const responseBodyText = text(response.body);
  const responseBody = parseJsonRecord(responseBodyText);
  const choices = Array.isArray(responseBody?.choices) ? responseBody.choices : [];
  const choice = asRecord(choices[0]);
  const assistantMessage = asRecord(choice.message);
  const responseContent = text(assistantMessage.content) ?? responseBodyText;

  return {
    request: {
      metadata: compactRecord({
        callId: started?.callId,
        timestamp: started?.timestamp,
        context: started?.context,
        url: request.url,
        method: request.method,
        headers: request.headers,
      }),
      parameters,
      systemPrompt,
      userMessage: {
        title: parsedUserMessage.title,
        instructions: parsedUserMessage.instructions,
      },
      evidence: parsedUserMessage.evidence,
    },
    response: {
      metadata: compactRecord({
        callId: finished?.callId,
        timestamp: finished?.timestamp,
        event: finished?.event,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        summary: finished?.summary,
        error: finished?.error,
      }),
      content: responseContent,
      reasoning: text(assistantMessage.reasoning_content),
      finishReason: text(choice.finish_reason),
      usage: responseBody ? asNullableRecord(responseBody.usage) : null,
    },
  };
}

function parseTaskUserMessage(content: string) {
  const startTag = '<task-evidence-json>';
  const endTag = '</task-evidence-json>';
  const start = content.indexOf(startTag);
  const end = content.indexOf(endTag, start + startTag.length);
  if (start === -1 || end === -1) {
    return { title: null, instructions: content.trim(), evidence: null };
  }
  const prefix = content.slice(0, start).trim();
  const lines = prefix.split(/\r?\n/);
  const titleLine = lines[0]?.match(/^Task title:\s*(.*)$/);
  const title = titleLine?.[1]?.trim() || null;
  const instructions = (titleLine ? lines.slice(1) : lines).join('\n').trim();
  const evidenceText = content.slice(start + startTag.length, end).trim();
  return {
    title,
    instructions,
    evidence: parseJsonRecord(evidenceText),
  };
}

function parseJsonRecord(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return asNullableRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function asNullableRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return asNullableRecord(value) ?? {};
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
