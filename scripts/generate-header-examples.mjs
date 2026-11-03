#!/usr/bin/env node
// Generate CODEX terminal wordmarks using only foreground colors and text glyphs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'docs/header-examples');
const font = {
  C: ['011111', '110000', '110000', '110000', '110000', '110000', '011111'],
  O: ['011110', '110011', '110011', '110011', '110011', '110011', '011110'],
  D: ['111100', '110110', '110011', '110011', '110011', '110110', '111100'],
  E: ['111111', '110000', '110000', '111110', '110000', '110000', '111111'],
  X: ['110011', '110011', '011110', '001100', '011110', '110011', '110011'],
};
const arrow = ['100', '110', '011', '001', '011', '110', '100'];
const key = (x, y) => `${x},${y}`;
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

function pixels(withArrow) {
  const mask = new Set();
  function stamp(rows, left) {
    rows.forEach((row, y) => [...row].forEach((bit, x) => {
      if (bit === '1') {
        mask.add(key(left + x * 2, y));
        mask.add(key(left + x * 2 + 1, y));
      }
    }));
  }
  if (withArrow) stamp(arrow, 0);
  let left = withArrow ? 9 : 0;
  const spacing = withArrow ? 1 : 3;
  for (const letter of 'CODEX') {
    stamp(font[letter], left);
    left += 12 + spacing;
  }
  return { mask, width: left - spacing };
}

function wordmark(kind) {
  const cool = kind === 'cool';
  const { mask, width } = pixels(cool);
  const grid = Array.from({ length: cool ? 8 : 9 }, () => Array(width + 3).fill(null));
  const has = (x, y) => mask.has(key(x, y));
  const set = (x, y, glyph, color) => { grid[y][x] = { glyph, color }; };
  for (const position of mask) {
    const [x, y] = position.split(',').map(Number);
    if (cool) {
      const hue = mix([47, 160, 235], [207, 93, 132], x / (width - 1));
      set(x + 1, y + 1, (x + y) % 3 ? '░' : '▒', mix([21, 25, 31], hue, 0.5));
    } else {
      // Thin offset contours and a small extrusion behind the warm face.
      const right = !has(x + 1, y);
      const bottom = !has(x, y + 1);
      const left = !has(x - 1, y);
      const top = !has(x, y - 1);
      const glyph = right && bottom ? '┘' : left && bottom ? '└'
        : right && top ? '┐' : left && top ? '┌'
          : bottom || top ? '─' : right || left ? '│' : null;
      if (glyph) set(x + 2, y + 2, glyph, [175, 108, 77]);
    }
  }
  if (!cool) {
    for (const position of mask) {
      const [x, y] = position.split(',').map(Number);
      set(x + 1, y + 1, '▓', mix([192, 118, 85], [117, 66, 53], y / 6));
    }
  }
  // Paint the face last so shadows never overwrite the lettering.
  for (const position of mask) {
    const [x, y] = position.split(',').map(Number);
    const color = cool
      ? (x / (width - 1) < 0.5
          ? mix([47, 160, 235], [143, 117, 210], x / (width - 1) * 2)
          : mix([143, 117, 210], [207, 93, 132], x / (width - 1) * 2 - 1))
      : (y < 3 ? mix([255, 222, 0], [255, 177, 0], y / 3)
        : mix([255, 177, 0], [204, 132, 99], (y - 3) / 3));
    set(x, y, '█', color);
  }
  return grid;
}

function ansi(grid) {
  return grid.map((row) => {
    let previous = '';
    return row.map((cell) => {
      if (!cell) return ' ';
      const color = cell.color.join(';');
      const prefix = color === previous ? '' : `\x1b[38;2;${color}m`;
      previous = color;
      return prefix + cell.glyph;
    }).join('').trimEnd() + '\x1b[0m';
  }).join('\n') + '\n\n\x1b[90m{directory}\x1b[0m\n';
}

const examples = ['cool', 'warm'].map((kind) => ({ kind, grid: wordmark(kind) }));
mkdirSync(output, { recursive: true });
for (const { kind, grid } of examples) {
  const colored = ansi(grid);
  if (Buffer.byteLength(colored) > 64 * 1024) throw new Error('Header exceeds 64 KiB');
  writeFileSync(resolve(output, `codex-${kind}.ansi`), colored);
  writeFileSync(resolve(output, `codex-${kind}.txt`), grid.map((row) =>
    row.map((cell) => cell?.glyph ?? ' ').join('').trimEnd()).join('\n') + '\n\n{directory}\n');
}

// Vector preview uses the same grid and palette as the actual ANSI files.
const cellWidth = 10;
const cellHeight = 20;
const margin = 32;
const svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="850" height="480" viewBox="0 0 850 480">',
  '<rect width="850" height="480" rx="16" fill="#15191f"/>'];
for (const [index, { kind, grid }] of examples.entries()) {
  const top = 54 + index * 220;
  svg.push(`<text x="${margin}" y="${top - 16}" fill="#a0a8b5" font-family="Consolas,monospace" font-size="13">CODEX / ${kind.toUpperCase()}</text>`);
  grid.forEach((row, y) => row.forEach((cell, x) => {
    if (!cell) return;
    const left = margin + x * cellWidth;
    const upper = top + y * cellHeight;
    const color = hex(cell.color);
    if (cell.glyph === '█') {
      svg.push(`<rect x="${left}" y="${upper}" width="10" height="20" fill="${color}"/>`);
    } else {
      svg.push(`<text x="${left}" y="${upper + 16}" fill="${color}" font-family="Consolas,monospace" font-size="17">${cell.glyph}</text>`);
    }
  }));
}
svg.push('</svg>');
writeFileSync(resolve(output, 'preview.svg'), svg.join('\n') + '\n');
const previewFlag = process.argv.indexOf('--preview-data');
if (previewFlag !== -1) {
  const path = resolve(root, process.argv[previewFlag + 1]);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(examples));
}
console.log(`Generated cool and warm CODEX headers in ${output}`);
