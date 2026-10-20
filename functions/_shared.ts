import { z } from 'zod';
import type { ExplainRequest, LessonContext } from '../src/lib/contracts';

export interface WorkersAiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface Env {
  AI?: WorkersAiBinding;
  WORKERS_AI_MODEL?: string;
}

export type AIMessagePart = { text: string } | { inlineData: { mimeType: string; data: string } };

export class ApiFault extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

export function fail(fault: unknown): Response {
  if (fault instanceof ApiFault) {
    return jsonResponse({ error: { code: fault.code, message: fault.message } }, fault.status);
  }
  if (fault instanceof z.ZodError) {
    return jsonResponse({ error: { code: 'INVALID_REQUEST', message: 'Some submitted information is missing or invalid. Check the fields and try again.' } }, 400);
  }
  if (fault instanceof Error && fault.name === 'AbortError') {
    return jsonResponse({ error: { code: 'TIMEOUT', message: 'The science tutor took too long to respond. Check your connection and retry.' } }, 504);
  }
  return jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'Flow AI could not finish this request. Please try again.' } }, 500);
}

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 18;
const rateCounters = new Map<string, { count: number; resetAt: number }>();

/** Best-effort isolate-local protection; configure Cloudflare WAF/rate limiting for stronger public protection. */
export function checkRateLimit(request: Request): Response | null {
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown-client';
  const now = Date.now();
  let current = rateCounters.get(ip);
  if (!current || current.resetAt <= now) current = { count: 0, resetAt: now + RATE_WINDOW_MS };
  current.count += 1;
  rateCounters.set(ip, current);
  if (rateCounters.size > 5000) {
    for (const [key, value] of rateCounters) if (value.resetAt <= now) rateCounters.delete(key);
  }
  if (current.count > RATE_LIMIT) {
    return jsonResponse({ error: { code: 'RATE_LIMITED', message: 'Too many requests in a short time. Wait a minute, then try again.' } }, 429, {
      'Retry-After': String(Math.max(1, Math.ceil((current.resetAt - now) / 1000))),
    });
  }
  return null;
}

export async function readJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 7_800_000) {
    throw new ApiFault(413, 'PAYLOAD_TOO_LARGE', 'The request is too large. Use no more than 5 MB of textbook images in one lesson.');
  }
  let raw = '';
  try {
    raw = await request.text();
  } catch {
    throw new ApiFault(400, 'INVALID_REQUEST', 'The request could not be read. Please try again.');
  }
  if (raw.length > 7_800_000) throw new ApiFault(413, 'PAYLOAD_TOO_LARGE', 'The request is too large. Use no more than 5 MB of textbook images in one lesson.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiFault(400, 'INVALID_JSON', 'The request was not valid JSON. Please try again.');
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new ApiFault(400, 'INVALID_REQUEST', 'Some submitted information is missing or invalid. Check the fields and try again.');
  return result.data;
}

function decodeBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new ApiFault(400, 'INVALID_FILE', 'A textbook image could not be read. Upload it again as JPEG, PNG, or WebP.');
  }
  try {
    const binary = atob(value);
    const output = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
    return output;
  } catch {
    throw new ApiFault(400, 'INVALID_FILE', 'A textbook image could not be read. Upload it again as JPEG, PNG, or WebP.');
  }
}

function detectedImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

export function validateImages(body: ExplainRequest): void {
  let totalBytes = 0;
  for (const image of body.images) {
    const bytes = decodeBase64(image.data);
    totalBytes += bytes.byteLength;
    if (bytes.byteLength > 5 * 1024 * 1024) {
      throw new ApiFault(413, 'FILE_TOO_LARGE', 'Each textbook image must be 5 MB or smaller.');
    }
    const detected = detectedImageMime(bytes);
    if (!detected || detected !== image.mimeType) {
      throw new ApiFault(400, 'INVALID_FILE_TYPE', 'The image content does not match its file type. Use a valid JPEG, PNG, or WebP image.');
    }
  }
  if (totalBytes > 5 * 1024 * 1024) {
    throw new ApiFault(413, 'PAYLOAD_TOO_LARGE', 'The combined size of textbook images must be 5 MB or smaller per lesson.');
  }
}

function modelName(env: Env): string {
  const model = (env.WORKERS_AI_MODEL || '@cf/meta/llama-3.2-11b-vision-instruct').trim();
  if (!/^@[A-Za-z0-9._/-]{2,140}$/.test(model)) {
    throw new ApiFault(500, 'MODEL_CONFIGURATION', 'The configured Workers AI model name is invalid. Check WORKERS_AI_MODEL in wrangler.toml or Cloudflare settings.');
  }
  return model;
}

function normalizeJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJsonSchema);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    // The reusable schema contracts use uppercase type names and propertyOrdering;
    // Workers AI's JSON Mode expects ordinary JSON Schema.
    if (key === 'propertyOrdering') continue;
    if (key === 'type' && typeof raw === 'string') {
      const types: Record<string, string> = { OBJECT: 'object', ARRAY: 'array', STRING: 'string', NUMBER: 'number', BOOLEAN: 'boolean', INTEGER: 'integer' };
      result[key] = types[raw] || raw;
    } else {
      result[key] = normalizeJsonSchema(raw);
    }
  }
  return result;
}

function extractModelText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const output = value as {
    response?: unknown;
    result?: unknown;
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  if (typeof output.response === 'string') return output.response.trim();
  if (typeof output.result === 'string') return output.result.trim();
  const content = output.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (content && typeof content === 'object') return JSON.stringify(content);
  return '';
}

async function providerRequest(env: Env, systemPrompt: string, parts: AIMessagePart[], responseSchema: unknown): Promise<string> {
  if (!env.AI || typeof env.AI.run !== 'function') {
    throw new ApiFault(503, 'CONFIGURATION_REQUIRED', 'AI is not connected yet. In Cloudflare, open your Pages project, choose Settings → Bindings → Add → Workers AI, and name the binding AI. Then redeploy.');
  }
  const model = modelName(env);
  const textContent = parts.filter((part): part is { text: string } => 'text' in part).map((part) => part.text).join('\n\n');
  const imageParts = parts.filter((part): part is { inlineData: { mimeType: string; data: string } } => 'inlineData' in part);
  if (imageParts.length > 1) {
    throw new ApiFault(400, 'TOO_MANY_IMAGES', 'The textbook pages could not be combined. Upload one clear page image or paste the relevant passage.');
  }
  const input: Record<string, unknown> = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: textContent },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: normalizeJsonSchema(responseSchema),
    },
    temperature: 0.25,
    max_tokens: 4000,
  };
  if (imageParts.length === 1) {
    const image = imageParts[0].inlineData;
    input.image = `data:${image.mimeType};base64,${image.data}`;
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        env.AI.run(model, input),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new ApiFault(504, 'TIMEOUT', 'The science tutor took too long to respond. Check your connection and retry.')), 45_000);
        }),
      ]);
      const text = extractModelText(result);
      if (!text) throw new ApiFault(502, 'EMPTY_PROVIDER_RESPONSE', 'The AI service returned no explanation. Please retry.');
      return text;
    } catch (error) {
      if (error instanceof ApiFault) {
        if (error.code === 'TIMEOUT' || error.status === 429 || error.status < 500) throw error;
        lastError = error;
      } else {
        const message = error instanceof Error ? error.message : String(error);
        if (/3036|daily free allocation|neurons|rate.?limit|too many requests/i.test(message)) {
          throw new ApiFault(429, 'AI_DAILY_LIMIT', 'Flow AI has reached its free AI usage limit for today. It resets daily. Please try again tomorrow.');
        }
        if (/no such model|invalid model|model.*not found|model requires/i.test(message)) {
          throw new ApiFault(503, 'MODEL_CONFIGURATION', 'The configured AI model is unavailable on this Cloudflare plan. Check WORKERS_AI_MODEL and choose a supported free vision model.');
        }
        lastError = error;
      }
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 350));
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
  console.warn('Workers AI request failed after a controlled retry.', lastError instanceof Error ? lastError.message : 'provider error');
  throw new ApiFault(503, 'PROVIDER_UNAVAILABLE', 'The AI service is temporarily unavailable or out of capacity. Try again shortly.');
}

export async function generateStructured<T>(args: {
  env: Env;
  systemPrompt: string;
  parts: AIMessagePart[];
  responseSchema: unknown;
  validator: ZodType<T>;
  invalidResponseMessage: string;
}): Promise<T> {
  let lastIssue: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const systemPrompt = attempt === 0 ? args.systemPrompt : `${args.systemPrompt}\n\nSTRICT RECOVERY: The previous response did not pass application validation. Return only one complete JSON object that follows the supplied schema exactly. Check all required fields, array lengths, diagram node IDs, and arrow references. Do not include extra keys.`;
    const text = await providerRequest(args.env, systemPrompt, args.parts, args.responseSchema);
    let parsed: unknown;
    try {
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      parsed = JSON.parse(cleaned);
    } catch (error) {
      lastIssue = error;
      continue;
    }
    const result = args.validator.safeParse(parsed);
    if (result.success) return result.data;
    lastIssue = result.error;
  }
  console.warn('Structured AI response failed validation after one controlled retry.', lastIssue instanceof Error ? lastIssue.message : 'validation error');
  throw new ApiFault(502, 'INVALID_AI_OUTPUT', args.invalidResponseMessage);
}

export function lessonContextText(lesson: LessonContext): string {
  const sourceStatus = lesson.explanation.sourceAssessment.sourceStatus;
  const sourceNote = lesson.sourceText.trim()
    ? `Pasted NCERT source passage (use only for source-grounded claims):\n${lesson.sourceText}`
    : sourceStatus === 'image'
      ? `The original lesson used an uploaded textbook image. That image is intentionally not stored or resent for this follow-up request. Use the existing explanation and its source assessment as the available context; do not claim you reread the original page.`
      : sourceStatus === 'unreadable'
        ? `A textbook image was supplied in the original request but was not reliably readable. Do not treat specific NCERT claims as verified. Ask the student to upload a clearer image or paste the relevant text if source-specific clarification is needed.`
        : `No textbook source was supplied. The explanation below reflects the original question and general scientific knowledge; do not describe it as directly verified against an NCERT passage.`;
  return [
    `Class: CBSE Class ${lesson.classLevel}`,
    `Topic/chapter: ${lesson.topic || 'Not specified'}`,
    `Student's confusion: ${lesson.confusion}`,
    sourceNote,
    `Existing explanation context (already shown to the student):\n${JSON.stringify(lesson.explanation)}`,
  ].join('\n\n');
}
