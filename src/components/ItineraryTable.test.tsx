import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItineraryTable, PrintSheet } from './ItineraryTable';
import { usePlanner } from '../store';

// PrintMap instantiates real MapLibre (WebGL) — out of scope for jsdom tests
vi.mock('./PrintMap', () => ({ PrintMap: () => null }));

const S = () => usePlanner.getState();

beforeEach(() => {
  S().reset();
});

afterEach(cleanup);

const dayCards = (container: HTMLElement) => container.querySelectorAll('.day-card');

describe('ItineraryTable', () => {
  it('renders a day card per segment with the trip summary', () => {
    const { container } = render(<ItineraryTable />);
    expect(screen.getByText('Your itinerary')).toBeInTheDocument();
    expect(screen.getByText('6 days, sea to hills')).toBeInTheDocument();
    expect(dayCards(container)).toHaveLength(6);
    expect(screen.getByText(/Buckie/)).toBeInTheDocument();
    expect(screen.getByText(/Newtonmore/)).toBeInTheDocument();
  });

  it('highlights the longest and steepest days', () => {
    render(<ItineraryTable />);
    expect(screen.getByText('Longest')).toBeInTheDocument();
    expect(screen.getByText('Most climbing')).toBeInTheDocument();
  });

  it('adds a rest-day card when rest nights are set', () => {
    render(<ItineraryTable />);
    const stop = S().stops[1];
    act(() => S().setRestDays(stop.id, 1));
    expect(screen.getByText(`Rest day at ${stop.name}`)).toBeInTheDocument();
    expect(screen.getByText('Put your feet up')).toBeInTheDocument();
  });

  it('shows a taxi day when a segment is skipped', () => {
    const { container } = render(<ItineraryTable />);
    const [a, b] = S().stops;
    act(() => S().toggleSkip(`${a.id}>${b.id}`));
    expect(screen.getByText('By taxi')).toBeInTheDocument();
    expect(container.querySelector('.day-card.cab')).not.toBeNull();
  });

  it('selects a day when its card is clicked', async () => {
    const user = userEvent.setup();
    render(<ItineraryTable />);
    const [a, b] = S().stops;
    await user.click(screen.getAllByRole('button', { name: /Buckie/ })[0]);
    expect(S().selected).toBe(`${a.id}>${b.id}`);
  });

  it('expands an elevation profile when the climbing meta is clicked', async () => {
    const user = userEvent.setup();
    const { container } = render(<ItineraryTable />);
    const btn = screen.getAllByRole('button', { name: /elevation profile/i })[0];
    expect(container.querySelector('.day-elev')).toBeNull();
    await user.click(btn);
    expect(container.querySelector('.day-elev svg')).not.toBeNull();
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(S().selected).toBeNull(); // toggling the chart doesn't select the day
    await user.click(btn);
    expect(container.querySelector('.day-elev')).toBeNull();
  });

  it('shows only one elevation profile at a time', async () => {
    const user = userEvent.setup();
    const { container } = render(<ItineraryTable />);
    const btns = screen.getAllByRole('button', { name: /elevation profile/i });
    await user.click(btns[0]);
    await user.click(btns[1]);
    expect(container.querySelectorAll('.day-elev')).toHaveLength(1);
    expect(btns[0]).toHaveAttribute('aria-expanded', 'false');
    expect(btns[1]).toHaveAttribute('aria-expanded', 'true');
  });

  it('reports the hovered trail position while tracing the chart', async () => {
    const user = userEvent.setup();
    const { container } = render(<ItineraryTable />);
    await user.click(screen.getAllByRole('button', { name: /elevation profile/i })[0]);
    const svg = container.querySelector<SVGSVGElement>('.day-elev svg')!;
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 360,
      height: 92,
      right: 360,
      bottom: 92,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const [a, b] = S().stops;
    fireEvent.mouseMove(svg, { clientX: 180 });
    const lo = Math.min(a.trailIdx, b.trailIdx);
    const hi = Math.max(a.trailIdx, b.trailIdx);
    expect(S().hoverTrail).toBeGreaterThan(lo);
    expect(S().hoverTrail).toBeLessThan(hi);
    expect(container.querySelector('.elev-dot')).not.toBeNull();
    fireEvent.mouseLeave(svg);
    expect(S().hoverTrail).toBeNull();
    expect(container.querySelector('.elev-dot')).toBeNull();
  });

  it('clears the trail hover marker when the chart closes', async () => {
    const user = userEvent.setup();
    const { container } = render(<ItineraryTable />);
    const btn = screen.getAllByRole('button', { name: /elevation profile/i })[0];
    await user.click(btn);
    const svg = container.querySelector<SVGSVGElement>('.day-elev svg')!;
    fireEvent.mouseMove(svg, { clientX: 100 });
    expect(S().hoverTrail).not.toBeNull();
    await user.click(btn); // collapse while still "hovering" — unmount clears the marker
    expect(S().hoverTrail).toBeNull();
  });

  it('does not offer an elevation profile on taxi days', () => {
    const [a, b] = S().stops;
    act(() => S().toggleSkip(`${a.id}>${b.id}`));
    const { container } = render(<ItineraryTable />);
    const cab = container.querySelector('.day-card.cab')!;
    expect(cab.querySelector('button.elev')).toBeNull();
  });

  it('adds a free-text extra and removes it', async () => {
    const user = userEvent.setup();
    render(<ItineraryTable />);
    await user.click(screen.getAllByRole('button', { name: /\+ Add/ })[0]);
    await user.click(screen.getByPlaceholderText('Add a visit or note…'));
    await user.keyboard('distillery tour{Enter}');
    expect(screen.getByText('distillery tour')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove distillery tour' }));
    expect(screen.queryByText('distillery tour')).not.toBeInTheDocument();
  });
});

describe('PrintSheet', () => {
  it('renders a printable itinerary covering every day', () => {
    const { container } = render(<PrintSheet />);
    expect(screen.getByText('Speyside Way — inn-to-inn itinerary')).toBeInTheDocument();
    expect(container.querySelectorAll('section')).toHaveLength(6);
    expect(screen.getByText(/Buckie → Newtonmore \(sea to hills\)/)).toBeInTheDocument();
  });

  it('labels skipped segments as taxi days in print too', () => {
    const [a, b] = S().stops;
    act(() => S().toggleSkip(`${a.id}>${b.id}`));
    render(<PrintSheet />);
    expect(screen.getByText(/By taxi ≈/)).toBeInTheDocument();
  });
});
