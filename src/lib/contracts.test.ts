import { describe, expect, it } from 'vitest';
import { DiagramSchema, LessonExplanationSchema } from './contracts';

const explanation = {
  title: 'Why current changes',
  coreIdea: 'Current depends on the potential difference and resistance in the circuit.',
  steps: [
    { title: 'A potential difference exists', explanation: 'The cell creates an electrical potential difference across the circuit.' },
    { title: 'Charges respond', explanation: 'The electric field causes charges in the wire to drift.' },
    { title: 'Resistance limits flow', explanation: 'For the same potential difference, greater resistance means less current.' },
  ],
  everydayExample: {
    scenario: 'Water moving through a narrow pipe is a rough comparison.',
    connection: 'A narrower pipe can reduce water flow for the same pressure difference.',
    limitation: 'Electric current is charge flow, not water moving through a pipe.',
  },
  diagram: {
    type: 'flowchart', title: 'From potential difference to current',
    nodes: [{ id: 'cell', label: 'Potential difference', x: 22, y: 50 }, { id: 'wire', label: 'Charge drift', x: 50, y: 50 }, { id: 'current', label: 'Current', x: 78, y: 50 }],
    arrows: [{ from: 'cell', to: 'wire', label: 'creates field' }, { from: 'wire', to: 'current', label: 'is measured as' }],
    caption: 'A potential difference sets up conditions for charge drift.',
    textFallback: 'Potential difference → electric field → charge drift → current.',
  },
  ncertTerms: [{ term: 'Electric current', meaning: 'Rate of flow of electric charge.', role: 'It describes how much charge passes a point each second.' }],
  commonConfusion: { misunderstanding: 'Resistance uses up current.', correction: 'Resistance opposes current; it does not consume charge.', reason: 'Charge is conserved around an ordinary closed circuit.' },
  understandingCheck: { question: 'What happens to current if resistance increases while potential difference stays constant?' },
  sourceAssessment: { sourceUsed: false, sourceStatus: 'none', limitations: ['No textbook source was supplied.'] },
};

describe('lesson explanation contract', () => {
  it('accepts a seven-section lesson with valid diagram references', () => {
    expect(LessonExplanationSchema.safeParse(explanation).success).toBe(true);
  });

  it('rejects arrows that refer to nodes that do not exist', () => {
    const invalid = structuredClone(explanation);
    invalid.diagram.arrows[0].to = 'missing-node';
    expect(LessonExplanationSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects an explanation without the required causal steps', () => {
    const invalid = structuredClone(explanation);
    invalid.steps = [{ title: 'Only one step', explanation: 'Not enough to explain the mechanism.' }];
    expect(LessonExplanationSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects overlapping diagram nodes', () => {
    const invalid = structuredClone(explanation.diagram);
    invalid.nodes[1].x = 23;
    invalid.nodes[1].y = 51;
    expect(DiagramSchema.safeParse(invalid).success).toBe(false);
  });
});
