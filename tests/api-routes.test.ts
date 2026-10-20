import { describe, expect, it } from 'vitest';
import { onRequestPost as explainPost } from '../functions/api/explain';

const basePayload = { classLevel: '10', topic: 'Electricity', confusion: 'Why does resistance affect current?', sourceText: '', images: [] };

describe('explain endpoint failure safety', () => {
  it('returns a configuration error when the Workers AI binding is missing', async () => {
    const response = await explainPost({
      request: new Request('https://flow-ai.test/api/explain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(basePayload) }),
      env: { WORKERS_AI_MODEL: '@cf/meta/llama-3.2-11b-vision-instruct' },
    });
    expect(response.status).toBe(503);
    const body = await response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('CONFIGURATION_REQUIRED');
    expect(body.error.message).toMatch(/Workers AI|binding AI/);
  });

  it('rejects an image whose actual bytes do not match a supported image type', async () => {
    const response = await explainPost({
      request: new Request('https://flow-ai.test/api/explain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...basePayload, images: [{ name: 'fake.jpg', mimeType: 'image/jpeg', data: 'bm90aW1hZ2U=' }] }) }),
      env: {},
    });
    expect(response.status).toBe(400);
    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_FILE_TYPE');
  });

  it('rejects malformed JSON with a useful response', async () => {
    const response = await explainPost({ request: new Request('https://flow-ai.test/api/explain', { method: 'POST', body: '{nope' }), env: {} });
    expect(response.status).toBe(400);
    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_JSON');
  });
});
