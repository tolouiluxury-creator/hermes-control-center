import { useId } from 'react';

/**
 * A minimal trend line. Deliberately unlabelled and unscaled: it shows shape
 * over time, and the precise number sits next to it. Drawing axes here would
 * promise a precision this ring buffer does not have.
 */
export function Sparkline({
  values,
  color = 'var(--color-accent)',
  className = '',
  label,
}: {
  values: number[];
  color?: string;
  className?: string;
  label?: string;
}) {
  const gradientId = useId();

  if (values.length < 2) return null;

  const width = 100;
  const height = 24;

  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series must not become a jagged line from dividing by ~zero.
  const span = max - min < 1e-6 ? 1 : max - min;

  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / span) * (height - 2) - 1;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const line = `M ${points.join(' L ')}`;
  const area = `${line} L ${width},${height} L 0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      role="img"
      aria-label={
        label
          ? `${label}: Verlauf der letzten ${values.length} Messungen, aktuell ${values[values.length - 1]?.toFixed(0)}`
          : undefined
      }
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
