import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { TrailMap } from './components/TrailMap';
import { ItineraryTable, PrintSheet } from './components/ItineraryTable';
import { usePlanner } from './store';
import { TREK_LIST, TREKS } from './lib/treks';
import './App.css';

function TrekPicker() {
  const trek = usePlanner(s => s.trek);
  const setTrek = usePlanner(s => s.setTrek);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // listbox semantics: focus the selected option and drive options with arrow keys
    const opts = ref.current?.querySelector<HTMLButtonElement>('.trek-opt.on');
    (opts ?? ref.current?.querySelector<HTMLButtonElement>('.trek-opt'))?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onMenuKeyDown = (e: ReactKeyboardEvent) => {
    const opts = [...ref.current!.querySelectorAll<HTMLButtonElement>('.trek-opt')];
    const i = opts.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      opts[(i + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      opts[e.key === 'Home' ? 0 : opts.length - 1]?.focus();
    }
  };

  return (
    <span className="trek-pick" ref={ref}>
      <button
        ref={btnRef}
        className="trek-btn"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {TREKS[trek].name}
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <span
          className="trek-menu"
          role="listbox"
          aria-label="Scottish Highland treks"
          onKeyDown={onMenuKeyDown}
        >
          {TREK_LIST.map(t => (
            <button
              key={t.id}
              role="option"
              aria-selected={t.id === trek}
              className={`trek-opt${t.id === trek ? ' on' : ''}`}
              onClick={() => {
                setTrek(t.id);
                setOpen(false);
              }}
            >
              <span className="trek-opt-name">{t.name}</span>
              <span className="trek-opt-sub">
                {t.from} to {t.to}
              </span>
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

export default function App() {
  const imperial = usePlanner(s => s.imperial);
  const setImperial = usePlanner(s => s.setImperial);
  const reset = usePlanner(s => s.reset);
  const reversed = usePlanner(s => s.reversed);
  const toggleDirection = usePlanner(s => s.toggleDirection);
  const trek = usePlanner(s => s.trek);
  const meta = TREKS[trek];

  useEffect(() => {
    document.title = `${meta.name} — Inn-to-Inn Planner`;
  }, [meta.name]);

  return (
    <div className="app">
      <header>
        <div className="brand">
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
            <circle cx="18" cy="18" r="17" fill="#2E4B3C" />
            <path d="M6 25 L13 15 L17 20 L22 12 L30 25 Z" fill="#FBF9F4" />
            <path
              d="M8 28 C13 26 17 29 22 27 C25 26 27 27 29 27"
              stroke="#C47F1E"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          <div className="brand-text">
            <div className="brand-title">Choose a Scottish Highland Trek:</div>
            <div className="brand-sub">
              <TrekPicker />
              <span className="brand-sub-rest">
                Inn-to-inn planner · {reversed ? `${meta.to} to ${meta.from}` : `${meta.from} to ${meta.to}`}
              </span>
            </div>
          </div>
        </div>
        <div className="header-controls">
          <button
            className="dir-btn"
            onClick={toggleDirection}
            aria-label="Reverse hiking direction"
            title="Reverse hiking direction"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m17 3 4 4-4 4" />
              <path d="M21 7H8" />
              <path d="m7 21-4-4 4-4" />
              <path d="M3 17h13" />
            </svg>
            <span>{reversed ? meta.dirReverse : meta.dirForward}</span>
          </button>
          <button className="print-btn" onClick={() => window.print()} aria-label="Print itinerary">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 9V3h12v6" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            <span>Print</span>
          </button>
          <div className="units" role="group" aria-label="Units">
            <button
              aria-pressed={imperial}
              className={imperial ? 'on' : ''}
              onClick={() => setImperial(true)}
            >
              <span className="u-long">mi · ft</span>
              <span className="u-short">mi</span>
            </button>
            <button
              aria-pressed={!imperial}
              className={imperial ? '' : 'on'}
              onClick={() => setImperial(false)}
            >
              <span className="u-long">km · m</span>
              <span className="u-short">km</span>
            </button>
          </div>
          <button className="reset-btn" onClick={reset} aria-label="Reset route">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            <span>Reset route</span>
          </button>
        </div>
      </header>
      <main>
        <TrailMap key={trek} />
        <aside aria-label="Itinerary">
          <ItineraryTable />
          <PrintSheet />
        </aside>
      </main>
    </div>
  );
}
