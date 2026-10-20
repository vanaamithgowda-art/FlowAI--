import { beforeEach, describe, expect, it } from 'vitest';
import { clearSavedLessons, formatDate, loadSavedLessons, persistSavedLessons } from './storage';
import type { SavedLesson } from './contracts';

const lesson: SavedLesson = {
  id: 'lesson-1', classLevel: '10', topic: 'Electricity', confusion: 'Why does resistance affect current?', sourceText: '',
  explanation: {
    title: 'Understanding current', coreIdea: 'Current depends on voltage and resistance.',
    steps: [
      { title: 'A potential difference exists', explanation: 'The source provides potential difference.' },
      { title: 'Charges drift', explanation: 'The electric field causes charges to drift.' },
      { title: 'Resistance opposes drift', explanation: 'More resistance gives less current at the same voltage.' },
    ],
    everydayExample: { scenario: 'A narrow pipe restricts water flow.', connection: 'A pressure difference can drive flow.', limitation: 'Electric current is not water flow.' },
    diagram: { type: 'flowchart', title: 'Current mechanism', nodes: [{ id: 'a', label: 'Potential difference', x: 22, y: 50 }, { id: 'b', label: 'Current', x: 78, y: 50 }], arrows: [{ from: 'a', to: 'b', label: 'drives' }], caption: 'Potential difference drives charge drift.', textFallback: 'Potential difference → current.' },
    ncertTerms: [{ term: 'Resistance', meaning: 'Opposition to current.', role: 'It affects current for a given voltage.' }],
    commonConfusion: { misunderstanding: 'Resistance consumes charge.', correction: 'Resistance opposes current.', reason: 'Charge is conserved.' },
    understandingCheck: { question: 'What happens to current if resistance doubles and voltage stays fixed?' },
    sourceAssessment: { sourceUsed: false, sourceStatus: 'none', limitations: ['No specific source provided.'] },
  },
  createdAt: '2026-10-19T10:00:00.000Z', savedAt: '2026-10-19T10:05:00.000Z', attempts: [],
};

beforeEach(() => localStorage.clear());

describe('browser lesson storage', () => {
  it('persists and reloads valid lessons', () => {
    expect(persistSavedLessons([lesson])).toBe(true);
    expect(loadSavedLessons()).toEqual([lesson]);
  });

  it('does not crash on corrupt JSON', () => {
    localStorage.setItem('flow-ai-lessons-v1', '{broken');
    expect(loadSavedLessons()).toEqual([]);
  });

  it('filters malformed saved records instead of crashing', () => {
    localStorage.setItem('flow-ai-lessons-v1', JSON.stringify([lesson, { id: 'bad' }]));
    expect(loadSavedLessons()).toEqual([lesson]);
  });

  it('removes the saved lesson key', () => {
    persistSavedLessons([lesson]);
    expect(clearSavedLessons()).toBe(true);
    expect(loadSavedLessons()).toEqual([]);
  });

  it('formats dates consistently and handles invalid dates', () => {
    expect(formatDate('not-a-date')).toBe('Date unavailable');
    expect(formatDate('2026-10-19T10:00:00.000Z')).toMatch(/19 Oct 2026/);
  });
});
