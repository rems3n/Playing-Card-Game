'use client';

interface DataPoint {
  date: string;
  rating: number;
}

interface RatingChartProps {
  data: DataPoint[];
  height?: number;
}

export function RatingChart({ data, height = 150 }: RatingChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-[var(--text-secondary)] text-xs" style={{ height }}>
        Play more games to see your rating trend
      </div>
    );
  }

  if (data.length === 1) {
    return (
      <div className="flex items-center justify-center text-[var(--text-secondary)] text-xs" style={{ height }}>
        <span>Rating: <span className="text-white font-bold">{data[0].rating}</span></span>
      </div>
    );
  }

  const width = 400;
  const padding = { top: 10, right: 10, bottom: 25, left: 40 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const ratings = data.map((d) => d.rating);
  const minR = Math.min(...ratings) - 20;
  const maxR = Math.max(...ratings) + 20;
  const range = maxR - minR || 1;

  const points = data.map((d, i) => {
    const x = padding.left + (i / (data.length - 1)) * chartW;
    const y = padding.top + chartH - ((d.rating - minR) / range) * chartH;
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');

  // Area fill
  const areaPath = `${linePath} L${points[points.length - 1].x},${padding.top + chartH} L${points[0].x},${padding.top + chartH} Z`;

  // Y-axis labels
  const yLabels = [minR, minR + range / 2, maxR].map((v) => ({
    value: Math.round(v),
    y: padding.top + chartH - ((v - minR) / range) * chartH,
  }));

  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];
  const trending = lastPoint.rating >= firstPoint.rating;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
      {/* Grid lines */}
      {yLabels.map((label) => (
        <g key={label.value}>
          <line
            x1={padding.left}
            y1={label.y}
            x2={width - padding.right}
            y2={label.y}
            stroke="rgba(255,255,255,0.06)"
            strokeDasharray="4 4"
          />
          <text
            x={padding.left - 5}
            y={label.y + 4}
            textAnchor="end"
            fill="var(--text-secondary)"
            fontSize="10"
          >
            {label.value}
          </text>
        </g>
      ))}

      {/* Area fill */}
      <path
        d={areaPath}
        fill={trending ? 'rgba(129,182,76,0.1)' : 'rgba(231,76,60,0.1)'}
      />

      {/* Line */}
      <path
        d={linePath}
        fill="none"
        stroke={trending ? 'var(--accent-green)' : 'var(--accent-red)'}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* End dot */}
      <circle
        cx={lastPoint.x}
        cy={lastPoint.y}
        r="4"
        fill={trending ? 'var(--accent-green)' : 'var(--accent-red)'}
      />

      {/* X-axis dates */}
      <text x={padding.left} y={height - 5} fill="var(--text-secondary)" fontSize="9">
        {firstPoint.date}
      </text>
      <text x={width - padding.right} y={height - 5} textAnchor="end" fill="var(--text-secondary)" fontSize="9">
        {lastPoint.date}
      </text>
    </svg>
  );
}
