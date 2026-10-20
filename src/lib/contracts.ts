import { z } from 'zod';

export const ClassLevelSchema = z.enum(['9', '10']);
export type ClassLevel = z.infer<typeof ClassLevelSchema>;

const ShortText = z.string().trim().min(1).max(220);
const LongText = z.string().trim().min(1).max(3500);

export const DiagramNodeSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/),
  label: z.string().trim().min(1).max(80),
  x: z.number().min(10).max(90),
  y: z.number().min(12).max(88),
}).strict();

export const DiagramArrowSchema = z.object({
  from: z.string().min(1).max(32),
  to: z.string().min(1).max(32),
  label: z.string().max(50),
}).strict();

export const DiagramSchema = z.object({
  type: z.enum(['flowchart', 'labeled-layout']),
  title: ShortText,
  nodes: z.array(DiagramNodeSchema).min(2).max(8),
  arrows: z.array(DiagramArrowSchema).min(1).max(10),
  caption: LongText,
  textFallback: LongText,
}).strict().superRefine((diagram, ctx) => {
  const ids = new Set(diagram.nodes.map((node) => node.id));
  if (ids.size !== diagram.nodes.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Diagram node IDs must be unique.', path: ['nodes'] });
  }
  diagram.arrows.forEach((arrow, index) => {
    if (!ids.has(arrow.from) || !ids.has(arrow.to)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Every arrow must point to existing diagram nodes.', path: ['arrows', index] });
    }
    if (arrow.from === arrow.to) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A diagram arrow cannot point back to the same node.', path: ['arrows', index] });
    }
  });
  for (let i = 0; i < diagram.nodes.length; i += 1) {
    for (let j = i + 1; j < diagram.nodes.length; j += 1) {
      const a = diagram.nodes[i];
      const b = diagram.nodes[j];
      if (Math.abs(a.x - b.x) < 18 && Math.abs(a.y - b.y) < 17) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Diagram nodes should not overlap.', path: ['nodes', j] });
      }
    }
  }
});

export const LessonExplanationSchema = z.object({
  title: ShortText,
  coreIdea: LongText,
  steps: z.array(z.object({ title: ShortText, explanation: LongText }).strict()).min(3).max(5),
  everydayExample: z.object({
    scenario: LongText,
    connection: LongText,
    limitation: LongText,
  }).strict(),
  diagram: DiagramSchema,
  ncertTerms: z.array(z.object({ term: ShortText, meaning: LongText, role: LongText }).strict()).min(1).max(8),
  commonConfusion: z.object({ misunderstanding: LongText, correction: LongText, reason: LongText }).strict(),
  understandingCheck: z.object({ question: LongText }).strict(),
  sourceAssessment: z.object({
    sourceUsed: z.boolean(),
    sourceStatus: z.enum(['text', 'image', 'none', 'unreadable']),
    limitations: z.array(z.string().trim().min(1).max(300)).max(5),
  }).strict(),
}).strict();
export type LessonExplanation = z.infer<typeof LessonExplanationSchema>;

export const ImageInputSchema = z.object({
  name: z.string().trim().min(1).max(150),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  data: z.string().min(1).max(7_100_000),
}).strict();

export const ExplainRequestSchema = z.object({
  classLevel: ClassLevelSchema,
  topic: z.string().trim().max(160).default(''),
  confusion: z.string().trim().min(8).max(3000),
  sourceText: z.string().max(12000).default(''),
  images: z.array(ImageInputSchema).max(2).default([]),
}).strict().superRefine((body, ctx) => {
  if (body.sourceText.trim() && body.images.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose pasted text or textbook images, not both.', path: ['images'] });
  }
});
export type ExplainRequest = z.infer<typeof ExplainRequestSchema>;

export const LessonContextSchema = z.object({
  classLevel: ClassLevelSchema,
  topic: z.string().max(160),
  confusion: z.string().min(1).max(3000),
  sourceText: z.string().max(12000),
  explanation: LessonExplanationSchema,
}).strict();
export type LessonContext = z.infer<typeof LessonContextSchema>;

export const EvaluationSchema = z.object({
  verdict: z.enum(['correct', 'partially-correct', 'incorrect']),
  whatWasUnderstood: z.string().trim().min(1).max(1000),
  conceptualGap: z.string().trim().min(1).max(1200),
  targetedHint: z.string().max(500),
  retryRecommended: z.boolean(),
}).strict();
export type Evaluation = z.infer<typeof EvaluationSchema>;

export const EvaluateRequestSchema = z.object({
  lesson: LessonContextSchema,
  answer: z.string().trim().min(1).max(2500),
  previousAttempts: z.array(z.object({
    answer: z.string().max(2500),
    verdict: z.enum(['correct', 'partially-correct', 'incorrect']),
  }).strict()).max(8).default([]),
}).strict();
export type EvaluateRequest = z.infer<typeof EvaluateRequestSchema>;

export const HintRequestSchema = z.object({
  lesson: LessonContextSchema,
  answer: z.string().trim().min(1).max(2500),
  feedback: EvaluationSchema,
}).strict();
export type HintRequest = z.infer<typeof HintRequestSchema>;

export const RevealRequestSchema = z.object({
  lesson: LessonContextSchema,
  answer: z.string().trim().min(1).max(2500),
}).strict();
export type RevealRequest = z.infer<typeof RevealRequestSchema>;

export const HintResponseSchema = z.object({ hint: z.string().trim().min(1).max(700) }).strict();
export const RevealResponseSchema = z.object({
  modelAnswer: z.string().trim().min(1).max(1800),
  reasoning: z.string().trim().min(1).max(1500),
}).strict();
export type HintResponse = z.infer<typeof HintResponseSchema>;
export type RevealResponse = z.infer<typeof RevealResponseSchema>;

export const AttemptSchema = z.object({
  id: z.string().min(1),
  answer: z.string().min(1).max(2500),
  submittedAt: z.string().datetime(),
  feedback: EvaluationSchema,
  hint: z.string().max(700).optional(),
  modelAnswer: z.string().max(1800).optional(),
  modelReasoning: z.string().max(1500).optional(),
}).strict();
export type Attempt = z.infer<typeof AttemptSchema>;

export const SavedLessonSchema = z.object({
  id: z.string().min(1),
  classLevel: ClassLevelSchema,
  topic: z.string().max(160),
  confusion: z.string().min(1).max(3000),
  sourceText: z.string().max(12000),
  explanation: LessonExplanationSchema,
  createdAt: z.string().datetime(),
  savedAt: z.string().datetime(),
  attempts: z.array(AttemptSchema).max(30),
}).strict();
export type SavedLesson = z.infer<typeof SavedLessonSchema>;

// Shared JSON Schema contracts, normalized for Cloudflare Workers AI JSON Mode.
export const AI_EXPLANATION_JSON_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    coreIdea: { type: 'STRING' },
    steps: { type: 'ARRAY', minItems: 3, maxItems: 5, items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, explanation: { type: 'STRING' } }, required: ['title', 'explanation'], propertyOrdering: ['title', 'explanation'] } },
    everydayExample: { type: 'OBJECT', properties: { scenario: { type: 'STRING' }, connection: { type: 'STRING' }, limitation: { type: 'STRING' } }, required: ['scenario', 'connection', 'limitation'], propertyOrdering: ['scenario', 'connection', 'limitation'] },
    diagram: { type: 'OBJECT', properties: {
      type: { type: 'STRING', enum: ['flowchart', 'labeled-layout'] }, title: { type: 'STRING' },
      nodes: { type: 'ARRAY', minItems: 2, maxItems: 8, items: { type: 'OBJECT', properties: { id: { type: 'STRING' }, label: { type: 'STRING' }, x: { type: 'NUMBER', minimum: 10, maximum: 90 }, y: { type: 'NUMBER', minimum: 12, maximum: 88 } }, required: ['id', 'label', 'x', 'y'], propertyOrdering: ['id', 'label', 'x', 'y'] } },
      arrows: { type: 'ARRAY', minItems: 1, maxItems: 10, items: { type: 'OBJECT', properties: { from: { type: 'STRING' }, to: { type: 'STRING' }, label: { type: 'STRING' } }, required: ['from', 'to', 'label'], propertyOrdering: ['from', 'to', 'label'] } },
      caption: { type: 'STRING' }, textFallback: { type: 'STRING' },
    }, required: ['type', 'title', 'nodes', 'arrows', 'caption', 'textFallback'], propertyOrdering: ['type', 'title', 'nodes', 'arrows', 'caption', 'textFallback'] },
    ncertTerms: { type: 'ARRAY', minItems: 1, maxItems: 8, items: { type: 'OBJECT', properties: { term: { type: 'STRING' }, meaning: { type: 'STRING' }, role: { type: 'STRING' } }, required: ['term', 'meaning', 'role'], propertyOrdering: ['term', 'meaning', 'role'] } },
    commonConfusion: { type: 'OBJECT', properties: { misunderstanding: { type: 'STRING' }, correction: { type: 'STRING' }, reason: { type: 'STRING' } }, required: ['misunderstanding', 'correction', 'reason'], propertyOrdering: ['misunderstanding', 'correction', 'reason'] },
    understandingCheck: { type: 'OBJECT', properties: { question: { type: 'STRING' } }, required: ['question'], propertyOrdering: ['question'] },
    sourceAssessment: { type: 'OBJECT', properties: { sourceUsed: { type: 'BOOLEAN' }, sourceStatus: { type: 'STRING', enum: ['text', 'image', 'none', 'unreadable'] }, limitations: { type: 'ARRAY', maxItems: 5, items: { type: 'STRING' } } }, required: ['sourceUsed', 'sourceStatus', 'limitations'], propertyOrdering: ['sourceUsed', 'sourceStatus', 'limitations'] },
  },
  required: ['title', 'coreIdea', 'steps', 'everydayExample', 'diagram', 'ncertTerms', 'commonConfusion', 'understandingCheck', 'sourceAssessment'],
  propertyOrdering: ['title', 'coreIdea', 'steps', 'everydayExample', 'diagram', 'ncertTerms', 'commonConfusion', 'understandingCheck', 'sourceAssessment'],
} as const;

export const AI_EVALUATION_JSON_SCHEMA = {
  type: 'OBJECT', properties: {
    verdict: { type: 'STRING', enum: ['correct', 'partially-correct', 'incorrect'] },
    whatWasUnderstood: { type: 'STRING' }, conceptualGap: { type: 'STRING' },
    targetedHint: { type: 'STRING' }, retryRecommended: { type: 'BOOLEAN' },
  }, required: ['verdict', 'whatWasUnderstood', 'conceptualGap', 'targetedHint', 'retryRecommended'],
  propertyOrdering: ['verdict', 'whatWasUnderstood', 'conceptualGap', 'targetedHint', 'retryRecommended'],
} as const;
export const AI_HINT_JSON_SCHEMA = {
  type: 'OBJECT', properties: { hint: { type: 'STRING' } }, required: ['hint'], propertyOrdering: ['hint'],
} as const;
export const AI_REVEAL_JSON_SCHEMA = {
  type: 'OBJECT', properties: { modelAnswer: { type: 'STRING' }, reasoning: { type: 'STRING' } },
  required: ['modelAnswer', 'reasoning'], propertyOrdering: ['modelAnswer', 'reasoning'],
} as const;
