import { useEffect, useId, useMemo, useState, type MouseEvent } from 'react';
import { eleAt, fmtKm, fmtM, profileBetween } from '../lib/trail';
import { usePlanner } from '../store';

const W = 360;
const H = 92;
const PAD = { t: 18, r: 8, b: 16, l: 40 };

/** Inline elevation profile for one day's walk, in walked order (distance on x, elevation on y). */
export function ElevationProfile({
  fromIdx,
  toIdx,
  imperial,
}: {
  fromIdx: number;
  toIdx: number;
  imperial: boolean;
}) {
  const pts = useMemo(() => profileBetween(fromIdx, toIdx), [fromIdx, toIdx]);
  const setHoverTrail = usePlanner(s => s.setHoverTrail);
  const gid = useId().replaceAll(':', '');
  const [hover, setHover] = useState<{ km: number; idx: number } | null>(null);
  const totalKm = pts[pts.length - 1].km;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    if (p.ele < lo) lo = p.ele;
    if (p.ele > hi) hi = p.ele;
  }
  // near-flat days get a floor on the y range so the line sits mid-chart
  const mid = (lo + hi) / 2;
  const half = Math.max((hi - lo) / 2, 5);
  const y0 = mid - half;
  const y1 = mid + half;

  const base = H - PAD.b;
  const x = (km: number) => PAD.l + (totalKm ? km / totalKm : 0) * (W - PAD.l - PAD.r);
  const y = (ele: number) => PAD.t + (1 - (ele - y0) / (y1 - y0)) * (base - PAD.t);
  const line = pts
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.km).toFixed(1)},${y(p.ele).toFixed(1)}`)
    .join(' ');
  const area = `${line}L${x(totalKm).toFixed(1)},${base}L${x(0).toFixed(1)},${base}Z`;

  // fractional trail index at a walked distance, interpolating between samples
  const idxAtKm = (km: number) => {
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].km >= km) {
        const a = pts[i - 1];
        const b = pts[i];
        const t = b.km > a.km ? (km - a.km) / (b.km - a.km) : 0;
        return a.idx + (b.idx - a.idx) * t;
      }
    }
    return pts[pts.length - 1].idx;
  };

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / (r.width || 1)) * W;
    const km = Math.max(0, Math.min(totalKm, ((vx - PAD.l) / (W - PAD.l - PAD.r)) * totalKm));
    const idx = idxAtKm(km);
    setHover({ km, idx });
    setHoverTrail(idx);
  };
  const onLeave = () => {
    setHover(null);
    setHoverTrail(null);
  };
  // clear the map marker if the chart unmounts while hovered
  useEffect(() => () => setHoverTrail(null), [setHoverTrail]);

  const hoverEle = hover ? eleAt(hover.idx) : 0;

  return (
    <div className="day-elev">
      <div className="elev-read">
        {hover ? `${fmtKm(hover.km, imperial)} · ${fmtM(hoverEle, imperial)}` : ' '}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Elevation profile: ${fmtKm(totalKm, imperial)}, high point ${fmtM(hi, imperial)}, low point ${fmtM(lo, imperial)}`}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7c9876" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#7c9876" stopOpacity="0.06" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`} />
        <line x1={PAD.l} y1={base} x2={W - PAD.r} y2={base} className="elev-axis" />
        <path d={line} fill="none" className="elev-line" />
        <text x={PAD.l - 5} y={PAD.t - 6} className="elev-lbl" textAnchor="end">
          {fmtM(hi, imperial)}
        </text>
        <text x={PAD.l - 5} y={base + 1} className="elev-lbl" textAnchor="end">
          {fmtM(lo, imperial)}
        </text>
        <text x={PAD.l} y={H - 4} className="elev-lbl">
          0
        </text>
        <text x={W - PAD.r} y={H - 4} className="elev-lbl" textAnchor="end">
          {fmtKm(totalKm, imperial)}
        </text>
        {hover && (
          <g aria-hidden="true">
            <line
              x1={x(hover.km)}
              y1={PAD.t}
              x2={x(hover.km)}
              y2={base}
              className="elev-cross"
            />
            <circle cx={x(hover.km)} cy={y(hoverEle)} r={3.5} className="elev-dot" />
          </g>
        )}
      </svg>
    </div>
  );
}
