import { useMemo } from 'react';
import type { LessonExplanation } from '../lib/contracts';

interface Props {
  diagram: LessonExplanation['diagram'];
}

function wrapLabel(label: string, maxChars = 22): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= maxChars) current += ` ${word}`;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

export default function Diagram({ diagram }: Props) {
  const nodeMap = useMemo(() => new Map(diagram.nodes.map((node) => [node.id, node])), [diagram.nodes]);
  const nodeWidth = 184;
  const nodeHeight = 86;
  const cx = (x: number) => x * 10;
  const cy = (y: number) => y * 6;

  return (
    <div className="diagram-frame">
      <p className="diagram-title">{diagram.title}</p>
      <svg className="science-diagram" viewBox="0 0 1000 600" role="img" aria-label={`${diagram.title}. ${diagram.caption}`} xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="flow-arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L8,4 L0,8 z" fill="#4779bf" />
          </marker>
        </defs>
        <g className="diagram-arrows">
          {diagram.arrows.map((arrow, index) => {
            const from = nodeMap.get(arrow.from);
            const to = nodeMap.get(arrow.to);
            if (!from || !to) return null;
            const dx = cx(to.x) - cx(from.x);
            const dy = cy(to.y) - cy(from.y);
            const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            const ux = dx / length;
            const uy = dy / length;
            const boundaryDistance = Math.min(
              (nodeWidth / 2) / Math.max(Math.abs(ux), 0.001),
              (nodeHeight / 2) / Math.max(Math.abs(uy), 0.001),
            );
            const distance = Math.min(boundaryDistance, Math.max(8, length / 2 - 4));
            const x1 = cx(from.x) + ux * distance;
            const y1 = cy(from.y) + uy * distance;
            const x2 = cx(to.x) - ux * distance;
            const y2 = cy(to.y) - uy * distance;
            const lx = (x1 + x2) / 2;
            const ly = (y1 + y2) / 2 - 12;
            return (
              <g key={`${arrow.from}-${arrow.to}-${index}`}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} markerEnd="url(#flow-arrowhead)" />
                {arrow.label && <text className="diagram-arrow-label" x={lx} y={ly} textAnchor="middle">{arrow.label}</text>}
              </g>
            );
          })}
        </g>
        <g className="diagram-nodes">
          {diagram.nodes.map((node) => {
            const lines = wrapLabel(node.label);
            return (
              <g key={node.id} transform={`translate(${cx(node.x) - nodeWidth / 2}, ${cy(node.y) - nodeHeight / 2})`}>
                <rect width={nodeWidth} height={nodeHeight} rx="14" />
                <text x={nodeWidth / 2} y={nodeHeight / 2 - ((lines.length - 1) * 8)} textAnchor="middle">
                  {lines.map((line, index) => <tspan key={index} x={nodeWidth / 2} dy={index === 0 ? 0 : 18}>{line}</tspan>)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <p className="diagram-caption">{diagram.caption}</p>
      <details className="diagram-text-fallback">
        <summary>Read the diagram as text</summary>
        <p>{diagram.textFallback}</p>
      </details>
    </div>
  );
}
