import { TrailMap } from './components/TrailMap';
import { ItineraryTable } from './components/ItineraryTable';
import { usePlanner } from './store';
import './App.css';

export default function App() {
  const imperial = usePlanner(s => s.imperial);
  const setImperial = usePlanner(s => s.setImperial);
  const reset = usePlanner(s => s.reset);

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
            <div className="brand-title">Speyside Way</div>
            <div className="brand-sub">Inn-to-inn planner · Buckie to Newtonmore</div>
          </div>
        </div>
        <div className="header-controls">
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
        <TrailMap />
        <aside aria-label="Itinerary">
          <ItineraryTable />
        </aside>
      </main>
    </div>
  );
}
