import { usePlanner } from '../store';
import { deriveDays } from '../lib/itinerary';
import { distilleriesNear, distilleryPois, fmtKm, fmtM, lunchPois, POIS } from '../lib/trail';

const ICONS = {
  mountain: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="m8 3 4 8 5-5 5 15H2L8 3z" />
    </svg>
  ),
  utensils: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
      <path d="M7 2v20" />
      <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
    </svg>
  ),
  bed: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 4v16" />
      <path d="M2 8h18a2 2 0 0 1 2 2v10" />
      <path d="M2 17h20" />
      <path d="M6 8v9" />
    </svg>
  ),
  car: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
      <circle cx="7" cy="17" r="2" />
      <path d="M9 17h6" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  ),
  pin: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="10" r="3" />
      <path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 6.9 8 11.7z" />
    </svg>
  ),
  bottle: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 2h5" />
      <path d="M10 2v4.3L7.4 8.9a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-9.9a2 2 0 0 0-.4-1.2L14 6.3V2" />
      <path d="M7 14h10" />
    </svg>
  ),
  close: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  ),
};

export function ItineraryTable() {
  const stops = usePlanner(s => s.stops);
  const restAt = usePlanner(s => s.restAt);
  const skipped = usePlanner(s => s.skipped);
  const imperial = usePlanner(s => s.imperial);
  const selected = usePlanner(s => s.selected);
  const { selectDay, focusSegment, openStop, toggleRest, toggleSkip, removeStop } =
    usePlanner.getState();

  const days = deriveDays(stops, restAt, skipped);
  const lastStopId = stops[stops.length - 1]?.id;

  const walkKm = days.reduce((s, d) => (d.type === 'walk' ? s + d.seg.distKm : s), 0);
  const gainM = days.reduce((s, d) => (d.type === 'walk' ? s + d.seg.gainM : s), 0);

  // each day ends with a night (walk/cab days at seg.to; a rest day adds another at the same stop)
  let nights = 0;
  let booked = 0;
  for (const d of days) {
    nights++;
    const stop = d.type === 'rest' ? d.stop : d.seg.to;
    if (stop.lodgingId) booked++;
  }

  const walkSegs = days.flatMap(d => (d.type === 'walk' ? [d.seg] : []));
  const maxKm = Math.max(0, ...walkSegs.map(s => s.distKm));
  const maxGain = Math.max(0, ...walkSegs.map(s => s.gainM));

  const distVal = (km: number) => (imperial ? (km * 0.621371).toFixed(1) : km.toFixed(1));
  const distUnit = imperial ? 'mi' : 'km';
  const gain = (m: number) =>
    `${(imperial ? Math.round(m * 3.28084) : Math.round(m)).toLocaleString('en-US')} ${imperial ? 'ft' : 'm'}`;

  let dayNum = 0;
  return (
    <>
      <div className="side-head">
        <div className="eyebrow">Your itinerary</div>
        <h2 className="side-title">
          {days.length} day{days.length === 1 ? '' : 's'}, sea to hills
        </h2>
        <div className="stat-strip">
          <div className="stat">
            <div className="stat-label">Distance</div>
            <div className="stat-val">{fmtKm(walkKm, imperial)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Climbing</div>
            <div className="stat-val">{fmtM(gainM, imperial)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Nights booked</div>
            <div className="stat-val">
              {booked} <span className="stat-of">of {nights}</span>
            </div>
          </div>
        </div>
        <div className="side-summary-compact">
          <span>
            {fmtKm(walkKm, imperial)} · {fmtM(gainM, imperial)} climbing
          </span>
          <span className="nights-pill">
            {booked} of {nights} nights booked
          </span>
        </div>
      </div>

      <div className="day-cards">
        {days.map((d, i) => {
          dayNum++;
          const n = dayNum;

          if (d.type === 'rest') {
            const sel = selected === `rest:${d.stop.id}`;
            const lodge = d.stop.lodgingId ? POIS.find(p => p.id === d.stop.lodgingId) : null;
            const dists = distilleriesNear(d.stop.trailIdx).filter(p => p.name && p.popular);
            return (
              <div key={`r${i}`} className={`day-card rest${sel ? ' selected' : ''}`}>
                <button
                  className="day-main"
                  aria-pressed={sel}
                  onClick={() => selectDay(`rest:${d.stop.id}`)}
                >
                  <div className="day-badge">{n}</div>
                  <div className="day-body">
                    <div className="day-top">
                      <div className="day-title">Rest day at {d.stop.name}</div>
                      <div className="day-dist">—</div>
                    </div>
                    <div className="day-meta">
                      <span className="meta">Put your feet up</span>
                      {dists.length > 0 && (
                        <span className="meta distillery">
                          {ICONS.bottle}
                          {dists.slice(0, 2).map(p => p.name).join(', ')}
                          {dists.length > 2 ? ` +${dists.length - 2}` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
                <div className="day-actions">
                  <button
                    className={`lodge-pill${lodge ? ' set' : ''}`}
                    aria-label={`Choose lodging in ${d.stop.name}`}
                    onClick={() => openStop(d.stop.id)}
                  >
                    {ICONS.bed}
                    {lodge?.name ?? 'Choose lodging'}
                  </button>
                  <div className="day-icons">
                    <button aria-label="Remove rest day" onClick={() => toggleRest(d.stop.id)}>
                      {ICONS.close}
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          const { seg } = d;
          const isCab = d.type === 'cab';
          const sel = selected === seg.key;
          const lunch = isCab ? [] : lunchPois(seg.from.trailIdx, seg.to.trailIdx);
          const dists = isCab
            ? []
            : distilleryPois(seg.from.trailIdx, seg.to.trailIdx).filter(p => p.name && p.popular);
          const interior = seg.to.id !== lastStopId;
          const lodge = seg.to.lodgingId ? POIS.find(p => p.id === seg.to.lodgingId) : null;

          const tags: string[] = [];
          if (!isCab && seg.distKm === maxKm) tags.push('Longest');
          if (!isCab && seg.gainM === maxGain) tags.push('Most climbing');

          return (
            <div key={seg.key} className={`day-card${sel ? ' selected' : ''}${isCab ? ' cab' : ''}`}>
              <button
                className="day-main"
                aria-pressed={sel}
                onClick={() => selectDay(seg.key, seg.to.id)}
              >
                <div className="day-badge">{n}</div>
                <div className="day-body">
                  <div className="day-top">
                    <div className="day-title">
                      {seg.from.name} <span className="arrow">→</span> {seg.to.name}
                      {seg.to.warn && (
                        <span className="warn" title="No town/accommodation near this stop"> ⚠</span>
                      )}
                    </div>
                    <div className="day-dist">
                      {isCab ? `≈${distVal(seg.cabKm)}` : distVal(seg.distKm)}
                      <span className="day-unit">{distUnit}</span>
                    </div>
                  </div>
                  <div className="day-meta">
                    <span className="meta">
                      {ICONS.mountain}
                      {isCab ? '—' : gain(seg.gainM)}
                    </span>
                    <span className={`meta lunch${lunch.length || isCab ? '' : ' none'}`}>
                      {ICONS.utensils}
                      {isCab
                        ? 'By taxi'
                        : lunch.length
                          ? `${lunch.length} lunch stop${lunch.length > 1 ? 's' : ''}`
                          : 'Pack a lunch'}
                    </span>
                    {dists.length > 0 && (
                      <span className="meta distillery">
                        {ICONS.bottle}
                        {dists.slice(0, 2).map(p => p.name).join(', ')}
                        {dists.length > 2 ? ` +${dists.length - 2}` : ''}
                      </span>
                    )}
                    {tags.map(t => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
              <div className="day-actions">
                <button
                  className={`lodge-pill${lodge ? ' set' : ''}`}
                  aria-label={`Choose lodging in ${seg.to.name}`}
                  onClick={() => openStop(seg.to.id)}
                >
                  {ICONS.bed}
                  {lodge?.name ?? 'Choose lodging'}
                </button>
                <div className="day-icons">
                  <button
                    aria-label={`Taxi and bag transfer for day ${n}`}
                    className={isCab ? 'on' : ''}
                    onClick={() => toggleSkip(seg.key)}
                  >
                    {ICONS.car}
                  </button>
                  <button
                    aria-label={`Show day ${n} on the map`}
                    onClick={() => focusSegment(seg.key)}
                  >
                    {ICONS.pin}
                  </button>
                  {interior && (
                    <button aria-label={`Remove day ${n}`} onClick={() => removeStop(seg.to.id)}>
                      {ICONS.close}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
