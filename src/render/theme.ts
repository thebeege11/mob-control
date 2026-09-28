/** Original art direction: bright candy-toy world, chunky readable shapes. */
export interface Theme {
  name: string;
  bgTop: string;
  bgBottom: string;
  trackA: string;
  trackB: string;
  rail: string;
  railDark: string;
  line: string;
}

export const THEMES: Theme[] = [
  { name: 'Candy Skies', bgTop: '#2a1760', bgBottom: '#ff8fbf', trackA: '#f4efff', trackB: '#e2d9ff', rail: '#ff4f9a', railDark: '#b8246b', line: '#cfc2ff' },
  { name: 'Mint Lagoon', bgTop: '#0d3552', bgBottom: '#5fe8c8', trackA: '#effffa', trackB: '#d3f5eb', rail: '#18b58e', railDark: '#0a7a5f', line: '#b6eadb' },
  { name: 'Sunset Dunes', bgTop: '#4d1636', bgBottom: '#ffb65e', trackA: '#fff5e6', trackB: '#ffe4c0', rail: '#ff7a3d', railDark: '#b8481a', line: '#f5d2a2' },
  { name: 'Neon Night', bgTop: '#07071f', bgBottom: '#4a1d8c', trackA: '#2d2b62', trackB: '#242254', rail: '#00e1ff', railDark: '#0078a8', line: '#3e3b86' },
  { name: 'Frost Peak', bgTop: '#1f3a73', bgBottom: '#bde4ff', trackA: '#ffffff', trackB: '#e1efff', rail: '#4a8dff', railDark: '#2556b8', line: '#c9dcf5' },
];

export const COLORS = {
  good: '#2f9bff',
  goodLight: '#8fd0ff',
  bad: '#ff3b6b',
  badLight: '#ff9db5',
  enemy: '#ff4757',
  enemyDark: '#b3202f',
  brute: '#c2203a',
  hazard: '#2b2140',
  hazardTop: '#43355e',
  hazardGlow: '#ff3df2',
  warn: '#ffd400',
  coin: '#ffcc2e',
  coinDark: '#d48c00',
  gem: '#4de0ff',
  surge: '#ffe14d',
  white: '#ffffff',
  ink: '#1d1433',
  fortress: '#ff5a6e',
  fortressDark: '#a8233a',
  crate: '#e89a4a',
  crateDark: '#a95e1f',
};
