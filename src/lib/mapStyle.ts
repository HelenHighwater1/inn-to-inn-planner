import type { StyleSpecification } from 'maplibre-gl';

/**
 * Custom muted basemap over OpenFreeMap vector tiles (OpenMapTiles schema).
 * Palette per design/design.md: land #ECE7D8, water #C9D8D6, rivers #9DBAC0,
 * woodland #DDE3CE, roads #DDD2B8, place labels uppercase #7B7F72,
 * water/hill labels italic serif-ish #5F8583 / #8C8470.
 * GL-rendered text is limited to hosted glyph fonts (Noto Sans family).
 */
export const MAP_STYLE: StyleSpecification = {
  version: 8,
  name: 'speyside-paper',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    openmaptiles: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#ECE7D8' },
    },
    {
      id: 'landcover',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['in', ['get', 'class'], ['literal', ['wood', 'forest', 'grass']]],
      paint: {
        'fill-color': [
          'match',
          ['get', 'class'],
          ['wood', 'forest'],
          '#DDE3CE',
          '#E4E8D6',
        ],
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.55, 12, 0.9],
      },
    },
    {
      id: 'landuse',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: [
        'in',
        ['get', 'class'],
        ['literal', ['park', 'cemetery', 'pitch', 'grass', 'wood', 'scrub']],
      ],
      paint: { 'fill-color': '#DDE3CE', 'fill-opacity': 0.6 },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: { 'fill-color': '#C9D8D6' },
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'waterway',
      paint: {
        'line-color': '#9DBAC0',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 14, 2.4],
      },
    },
    {
      id: 'road-minor',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: [
        'in',
        ['get', 'class'],
        ['literal', ['minor', 'service', 'track', 'path', 'footway', 'cycleway', 'bridleway']],
      ],
      minzoom: 11,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#D8CDB0',
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 15, 1.6],
      },
    },
    {
      id: 'road-major',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: [
        'in',
        ['get', 'class'],
        ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified']],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#DDD2B8',
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          7,
          ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], 1.6, 0.9],
          13,
          ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], 4.5, 2.6],
        ],
      },
    },
    {
      id: 'label-water',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'water_name',
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Italic'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 13, 15],
        'text-letter-spacing': 0.12,
      },
      paint: { 'text-color': '#5F8583' },
    },
    {
      id: 'label-peak',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'mountain_peak',
      minzoom: 9,
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Italic'],
        'text-size': 12.5,
        'text-letter-spacing': 0.08,
      },
      paint: {
        'text-color': '#8C8470',
        'text-halo-color': '#F5F1E8',
        'text-halo-width': 1.4,
      },
    },
    {
      id: 'label-place',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: [
        'in',
        ['get', 'class'],
        ['literal', ['city', 'town', 'village', 'suburb', 'quarter', 'hamlet']],
      ],
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.1,
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          8,
          ['match', ['get', 'class'], ['city', 'town'], 12, 10],
          13,
          ['match', ['get', 'class'], ['city', 'town'], 15, 11.5],
        ],
      },
      paint: {
        'text-color': '#7B7F72',
        'text-halo-color': '#F5F1E8',
        'text-halo-width': 1.6,
      },
    },
  ],
};
