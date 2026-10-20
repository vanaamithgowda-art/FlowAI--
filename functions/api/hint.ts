import { AI_HINT_JSON_SCHEMA, HintRequestSchema, HintResponseSchema } from '../../src/lib/contracts';
import { checkRateLimit, fail, generateStructured, jsonResponse, lessonContextText, readJson, type Env } from '../_shared';

const HINT_PROMPT = `You are a careful CBSE Class 9–10 science tutor. Give exactly one targeted hint that helps a student make their next reasoning step.
- Refer to their actual submitted attempt and feedback.
- Point attention toward a relevant relationship, cause, variable, or step.
- Do not give the final answer, a complete explanation, a formula substitution result, or the full reasoning chain.
- Keep it to one or two sentences. Use simple English.
Return one JSON object containing only the hint field.`;

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  const limited = checkRateLimit(request);
  if (limited) return limited;
  try {
    const body = await readJson(request, HintRequestSchema);
    const prompt = `${lessonContextText(body.lesson)}\n\nQuestion: ${body.lesson.explanation.understandingCheck.question}\nStudent's attempt: ${body.answer}\nFeedback already shown: ${JSON.stringify(body.feedback)}\n\nGive a fresh hint without giving away the answer.`;
    const result = await generateStructured({
      env,
      systemPrompt: HINT_PROMPT,
      parts: [{ text: prompt }],
      responseSchema: AI_HINT_JSON_SCHEMA,
      validator: HintResponseSchema,
      invalidResponseMessage: 'A useful hint could not be generated. Try again shortly.',
    });
    return jsonResponse(result);
  } catch (error) {
    return fail(error);
  }
};
