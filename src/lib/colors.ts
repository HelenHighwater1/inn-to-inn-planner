// Design tokens — see design/design.md
export const PAPER = '#F5F1E8';
export const PANEL = '#FBF9F4';
export const INK = '#1F2A24';
export const FOREST = '#2E4B3C';
export const MOSS = '#7C9876';
export const AMBER = '#C47F1E';
export const AMBER_TEXT = '#8F5A12';
export const HEATHER = '#6E4A7E';
export const HEATHER_TEXT = '#5A3B69';
export const SKIPPED = '#A39E8E';
export const PIN_FILL = '#FFFDF8';
export const COPPER = '#A05A2C';
export const COPPER_TEXT = '#7A4218';

/** Day segments alternate forest/moss; the selected day is amber. */
export const dayColor = (dayNum: number) => (dayNum % 2 ? FOREST : MOSS);
