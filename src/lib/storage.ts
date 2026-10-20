import { SavedLessonSchema, type SavedLesson } from './contracts';

const STORAGE_KEY = 'flow-ai-lessons-v1';

export function loadSavedLessons(): SavedLesson[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid: SavedLesson[] = [];
    for (const item of parsed) {
      const result = SavedLessonSchema.safeParse(item);
      if (result.success) valid.push(result.data);
    }
    return valid;
  } catch {
    // Corrupt JSON or unavailable storage should never make the app crash.
    return [];
  }
}

export function persistSavedLessons(lessons: SavedLesson[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lessons));
    return true;
  } catch {
    // QuotaExceededError is expected on some low-storage devices. The caller must inform the student.
    return false;
  }
}

export function clearSavedLessons(): boolean {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function formatDate(dateValue: string): string {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

export function lessonAsPlainText(lesson: SavedLesson): string {
  const e = lesson.explanation;
  const lines = [
    `Flow AI · ${e.title}`,
    `CBSE Class ${lesson.classLevel}${lesson.topic ? ` · ${lesson.topic}` : ''}`,
    `Student confusion: ${lesson.confusion}`,
    '',
    '1. CORE IDEA', e.coreIdea, '',
    '2. HOW IT WORKS', ...e.steps.map((step, index) => `${index + 1}. ${step.title}\n${step.explanation}`), '',
    '3. EVERYDAY EXAMPLE', e.everydayExample.scenario, e.everydayExample.connection, `Limit: ${e.everydayExample.limitation}`, '',
    '4. VISUAL EXPLANATION', e.diagram.title, e.diagram.textFallback, e.diagram.caption, '',
    '5. NCERT CONNECTION', ...e.ncertTerms.map((term) => `${term.term}: ${term.meaning}\nRole: ${term.role}`), '',
    '6. COMMON CONFUSION', e.commonConfusion.misunderstanding, e.commonConfusion.correction, e.commonConfusion.reason, '',
    '7. UNDERSTANDING CHECK', e.understandingCheck.question, '',
    'Source check', ...e.sourceAssessment.limitations.map((limitation) => `• ${limitation}`), '',
    'Practice attempts', ...lesson.attempts.flatMap((attempt, index) => [
      `Attempt ${index + 1}: ${attempt.answer}`,
      `Feedback: ${attempt.feedback.verdict.replace('-', ' ')} — ${attempt.feedback.whatWasUnderstood}`,
      attempt.feedback.conceptualGap,
      attempt.hint ? `Hint: ${attempt.hint}` : '',
      attempt.modelAnswer ? `Model answer: ${attempt.modelAnswer}` : '',
    ]),
    '', 'Created with Flow AI · Understand the science. Follow the logic.',
  ];
  return lines.filter((line) => line !== undefined).join('\n');
}
