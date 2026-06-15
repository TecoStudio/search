/**
 * MOTD parser — converts Minecraft server descriptions into raw / plain / html.
 *
 * Handles both:
 *   - legacy § format codes (§0-§9, §a-§f colors; §k §l §m §n §o §r styles)
 *   - modern JSON Chat Component objects (incl. nested `extra`, named & #hex colors)
 *
 * Output:
 *   raw   — original string containing § codes (reconstructed for JSON input)
 *   plain — text only, no formatting
 *   html  — <span style="..."> markup with MC official colors
 */

export interface ParsedMotd {
  raw: string;
  plain: string;
  html: string;
}

/** A chat component, loosely typed (servers send all sorts of shapes). */
export type ChatComponent =
  | string
  | {
      text?: string;
      color?: string;
      bold?: boolean;
      italic?: boolean;
      underlined?: boolean;
      strikethrough?: boolean;
      obfuscated?: boolean;
      extra?: ChatComponent[];
      [key: string]: unknown;
    };

export type MotdInput = ChatComponent;

const SECTION = '§';

/** Legacy color code → official MC hex value. */
const CODE_TO_HEX: Record<string, string> = {
  '0': '#000000',
  '1': '#0000aa',
  '2': '#00aa00',
  '3': '#00aaaa',
  '4': '#aa0000',
  '5': '#aa00aa',
  '6': '#ffaa00',
  '7': '#aaaaaa',
  '8': '#555555',
  '9': '#5555ff',
  a: '#55ff55',
  b: '#55ffff',
  c: '#ff5555',
  d: '#ff55ff',
  e: '#ffff55',
  f: '#ffffff',
};

/** JSON named color → official MC hex value. */
const NAME_TO_HEX: Record<string, string> = {
  black: '#000000',
  dark_blue: '#0000aa',
  dark_green: '#00aa00',
  dark_aqua: '#00aaaa',
  dark_red: '#aa0000',
  dark_purple: '#aa00aa',
  gold: '#ffaa00',
  gray: '#aaaaaa',
  dark_gray: '#555555',
  blue: '#5555ff',
  green: '#55ff55',
  aqua: '#55ffff',
  red: '#ff5555',
  light_purple: '#ff55ff',
  yellow: '#ffff55',
  white: '#ffffff',
};

/** hex → legacy code, for reconstructing a § string from JSON input. */
const HEX_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(CODE_TO_HEX).map(([code, hex]) => [hex, code]),
);

interface Style {
  color?: string; // hex
  bold?: boolean;
  italic?: boolean;
  underlined?: boolean;
  strikethrough?: boolean;
  obfuscated?: boolean;
}

export interface Span extends Style {
  text: string;
}

/** A styled MOTD run; `color` is a hex string. Used for non-HTML renderers (e.g. Satori). */
export type MotdSpan = Span;

function emptyStyle(): Style {
  return {};
}

/** Resolve a JSON `color` field (named or #hex) to a hex string. */
function resolveColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  if (color.startsWith('#')) return color.toLowerCase();
  return NAME_TO_HEX[color];
}

/**
 * Parse a legacy string (may contain § codes) starting from `base` style,
 * appending resulting spans to `out`.
 */
function parseLegacyInto(text: string, base: Style, out: Span[]): void {
  let style: Style = { ...base };
  let buf = '';

  const flush = () => {
    if (buf.length) {
      out.push({ ...style, text: buf });
      buf = '';
    }
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ((ch === SECTION || ch === '&') && i + 1 < text.length) {
      const code = text[i + 1].toLowerCase();
      if (code in CODE_TO_HEX) {
        flush();
        // A color code resets all formatting in Minecraft.
        style = { color: CODE_TO_HEX[code] };
        i++;
        continue;
      }
      switch (code) {
        case 'r':
          flush();
          style = { ...base, color: base.color };
          i++;
          continue;
        case 'l':
          flush();
          style = { ...style, bold: true };
          i++;
          continue;
        case 'm':
          flush();
          style = { ...style, strikethrough: true };
          i++;
          continue;
        case 'n':
          flush();
          style = { ...style, underlined: true };
          i++;
          continue;
        case 'o':
          flush();
          style = { ...style, italic: true };
          i++;
          continue;
        case 'k':
          flush();
          style = { ...style, obfuscated: true };
          i++;
          continue;
        default:
          // unknown code — drop the marker, keep going
          i++;
          continue;
      }
    }
    buf += ch;
  }
  flush();
}

/** Walk a JSON chat component tree into a flat span list. */
function walk(node: ChatComponent, parent: Style, out: Span[]): void {
  if (node == null) return;

  if (typeof node === 'string') {
    parseLegacyInto(node, parent, out);
    return;
  }

  if (Array.isArray(node)) {
    // First element is the parent of the rest, per chat-component rules.
    let inherited = parent;
    node.forEach((child, idx) => {
      walk(child, inherited, out);
      if (idx === 0 && typeof child === 'object' && child) {
        inherited = mergeStyle(parent, child);
      }
    });
    return;
  }

  const style = mergeStyle(parent, node);
  if (typeof node.text === 'string' && node.text.length) {
    parseLegacyInto(node.text, style, out);
  }
  if (Array.isArray(node.extra)) {
    for (const child of node.extra) walk(child, style, out);
  }
}

function mergeStyle(parent: Style, node: Exclude<ChatComponent, string>): Style {
  const color = resolveColor(node.color);
  return {
    color: color ?? parent.color,
    bold: node.bold ?? parent.bold,
    italic: node.italic ?? parent.italic,
    underlined: node.underlined ?? parent.underlined,
    strikethrough: node.strikethrough ?? parent.strikethrough,
    obfuscated: node.obfuscated ?? parent.obfuscated,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function spansToHtml(spans: Span[]): string {
  return spans
    .map((span) => {
      const css: string[] = [];
      css.push(`color:${span.color ?? '#ffffff'}`);
      if (span.bold) css.push('font-weight:700');
      if (span.italic) css.push('font-style:italic');
      const deco: string[] = [];
      if (span.underlined) deco.push('underline');
      if (span.strikethrough) deco.push('line-through');
      if (deco.length) css.push(`text-decoration:${deco.join(' ')}`);
      const cls = span.obfuscated ? ' class="motd-obfuscated"' : '';
      const text = escapeHtml(span.text).replace(/\n/g, '<br/>');
      return `<span${cls} style="${css.join(';')}">${text}</span>`;
    })
    .join('');
}

function spansToLegacy(spans: Span[]): string {
  return spans
    .map((span) => {
      let prefix = SECTION + 'r';
      if (span.color && HEX_TO_CODE[span.color]) {
        prefix += SECTION + HEX_TO_CODE[span.color];
      }
      if (span.bold) prefix += SECTION + 'l';
      if (span.strikethrough) prefix += SECTION + 'm';
      if (span.underlined) prefix += SECTION + 'n';
      if (span.italic) prefix += SECTION + 'o';
      if (span.obfuscated) prefix += SECTION + 'k';
      return prefix + span.text;
    })
    .join('');
}

/**
 * Parse a server description into a flat list of styled spans (hex colors).
 */
export function parseMotdSpans(input: MotdInput): MotdSpan[] {
  const spans: Span[] = [];
  walk(input, emptyStyle(), spans);
  return spans;
}

/**
 * Parse a server description (string or JSON chat component) into MOTD outputs.
 */
export function parseMotd(input: MotdInput): ParsedMotd {
  const spans = parseMotdSpans(input);

  const plain = spans.map((s) => s.text).join('');
  const html = spansToHtml(spans);
  const raw = typeof input === 'string' ? input : spansToLegacy(spans);

  return { raw, plain, html };
}
