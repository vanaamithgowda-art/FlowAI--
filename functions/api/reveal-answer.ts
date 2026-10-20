import { AI_REVEAL_JSON_SCHEMA, RevealRequestSchema, RevealResponseSchema } from '../../src/lib/contracts';
import { checkRateLimit, fail, generateStructured, jsonResponse, lessonContextText, readJson, type Env } from '../_shared';

const REVEAL_PROMPT = `You are a careful CBSE Class 9–10 science tutor. The student has made at least one attempt and explicitly requested the model answer.
- Give a concise, scientifically correct model answer to the exact application question.
- Explain the key causal link in a short reasoning note.
- Ground the answer in the supplied NCERT passage when present and the concept explanation already shown. Do not invent what a textbook says.
- If no source was supplied, answer from established scientific knowledge and do not claim NCERT verification.
- Keep language simple but preserve required scientific terms. Include units or equations only where relevant.
Return only JSON with modelAnswer and reasoning.`;

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  const limited = checkRateLimit(request);
  if (limited) return limited;
  try {
    const body = await readJson(request, RevealRequestSchema);
    const prompt = `${lessonContextText(body.lesson)}\n\nAPPLICATION QUESTION: ${body.lesson.explanation.understandingCheck.question}\nSTUDENT'S ATTEMPT: ${body.answer}\n\nNow provide the concise model answer and reasoning. The student attempted the question and chose to reveal it.`;
    const result = await generateStructured({
      env,
      systemPrompt: REVEAL_PROMPT,
      parts: [{ text: prompt }],
      responseSchema: AI_REVEAL_JSON_SCHEMA,
      validator: RevealResponseSchema,
      invalidResponseMessage: 'The model answer could not be validated. Try the reveal action again shortly.',
    });
    return jsonResponse(result);
  } catch (error) {
    return fail(error);
  }
};
