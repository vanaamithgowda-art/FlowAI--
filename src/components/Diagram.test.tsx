import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Diagram from './Diagram';
import type { LessonExplanation } from '../lib/contracts';

const diagram: LessonExplanation['diagram'] = {
  type: 'flowchart', title: 'A simple process',
  nodes: [{ id: 'start', label: 'Start', x: 25, y: 50 }, { id: 'end', label: 'End', x: 75, y: 50 }],
  arrows: [{ from: 'start', to: 'end', label: 'leads to' }],
  caption: 'One stage leads to another.', textFallback: 'Start → End.',
};

describe('safe diagram rendering', () => {
  it('renders labels as SVG text and offers a text alternative', () => {
    render(<Diagram diagram={diagram} />);
    expect(screen.getByRole('img', { name: 'A simple process. One stage leads to another.' })).toBeInTheDocument();
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByText('End')).toBeInTheDocument();
    expect(screen.getByText('Read the diagram as text')).toBeInTheDocument();
    expect(screen.getByText('Start → End.')).toBeInTheDocument();
  });
});
