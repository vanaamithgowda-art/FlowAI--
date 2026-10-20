import type {
  Evaluation, ExplainRequest, HintResponse, LessonContext, LessonExplanation,
  RevealResponse, SavedLesson,
} from './contracts';

export interface FlowImageInput {
  name: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  data: string;
}

export class FlowApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code = 'REQUEST_FAILED', status = 0) {
    super(message);
    this.name = 'FlowApiError';
    this.code = code;
    this.status = status;
  }
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(75_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new FlowApiError('The request timed out. Check your connection and retry.', 'TIMEOUT');
    }
    throw new FlowApiError('Could not reach Flow AI. Check your internet connection and retry.', 'NETWORK_ERROR');
  }

  let body: unknown;
  try { body = await response.json(); }
  catch { throw new FlowApiError('Flow AI returned an unreadable response. Please retry.', 'MALFORMED_RESPONSE', response.status); }

  if (!response.ok) {
    const errorBody = body as { error?: { message?: string; code?: string } };
    throw new FlowApiError(
      errorBody.error?.message || 'Flow AI could not complete this request. Please retry.',
      errorBody.error?.code || 'REQUEST_FAILED',
      response.status,
    );
  }
  return body as T;
}

export async function explainConcept(input: ExplainRequest): Promise<LessonExplanation> {
  const response = await postJson<{ explanation: LessonExplanation }>('/api/explain', input);
  return response.explanation;
}

export async function evaluateAnswer(
  lesson: LessonContext,
  answer: string,
  previousAttempts: Array<{ answer: string; verdict: Evaluation['verdict'] }>,
): Promise<Evaluation> {
  const response = await postJson<{ feedback: Evaluation }>('/api/evaluate', { lesson, answer, previousAttempts });
  return response.feedback;
}

export async function getHint(lesson: LessonContext, answer: string, feedback: Evaluation): Promise<HintResponse> {
  return postJson<HintResponse>('/api/hint', { lesson, answer, feedback });
}

export async function revealAnswer(lesson: LessonContext, answer: string): Promise<RevealResponse> {
  return postJson<RevealResponse>('/api/reveal-answer', { lesson, answer });
}

export function makeLessonContext(lesson: SavedLesson): LessonContext {
  return {
    classLevel: lesson.classLevel,
    topic: lesson.topic,
    confusion: lesson.confusion,
    sourceText: lesson.sourceText,
    explanation: lesson.explanation,
  };
}
