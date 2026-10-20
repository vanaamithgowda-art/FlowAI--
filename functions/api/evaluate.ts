import { EvaluationSchema, EvaluateRequestSchema, AI_EVALUATION_JSON_SCHEMA } from '../../src/lib/contracts';
import { checkRateLimit, fail, generateStructured, jsonResponse, lessonContextText, readJson, type Env } from '../_shared';

const EVALUATION_PROMPT = `You evaluate CBSE Class 9–10 science reasoning. Assess the student's explanation conceptually, not by keyword matching.
- Judge only the science asked in this question and distinguish a wrong idea from an incomplete answer.
- Return verdict "correct", "partially-correct", or "incorrect".
- Give concise feedback about what is genuinely understood and the specific missing/wrong link.
- targetedHint must be blank when the answer is correct. Otherwise give one short hint that points toward the next reasoning step.
- retryRecommended is normally true for partially correct or incorrect answers, and false for a clearly correct answer.
- Do NOT reveal the complete expected answer, write a model answer, or add a step-by-step solution. The feedback should help the student revise their own reasoning.
- A short answer can still be correct if it contains the essential scientific relationship. Do not reward a confident but scientifically false answer.
Return only the required JSON object.`;

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  const limited = checkRateLimit(request);
  if (limited) return limited;
  try {
    const body = await readJson(request, EvaluateRequestSchema);
    const prompt = `${lessonContextText(body.lesson)}\n\nAPPLICATION QUESTION: ${body.lesson.explanation.understandingCheck.question}\n\nSTUDENT'S CURRENT ANSWER:\n${body.answer}\n\nPRIOR ATTEMPTS (for progress context, not as answer keys):\n${JSON.stringify(body.previousAttempts)}\n\nAssess the current answer only. Do not reveal the model answer.`;
    const feedback = await generateStructured({
      env,
      systemPrompt: EVALUATION_PROMPT,
      parts: [{ text: prompt }],
      responseSchema: AI_EVALUATION_JSON_SCHEMA,
      validator: EvaluationSchema,
      invalidResponseMessage: 'The feedback could not be validated. Submit the answer again in a shorter, clearer form.',
    });
    return jsonResponse({ feedback });
  } catch (error) {
    return fail(error);
  }
};
