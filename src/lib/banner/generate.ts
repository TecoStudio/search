/**
 * Server banner generator — Satori (SVG) → resvg (PNG), 800×200.
 *
 * Renders favicon, MOTD (with format colors), online count, version and latency.
 * Offline servers still produce an image with a "服务器离线" notice.
 */
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

import { parseMotdSpans, type MotdSpan } from '../mc/motd-parser';
import type { ServerStatus } from '../mc/types';
import { getFonts, FONT_FAMILY } from './fonts';

export const BANNER_WIDTH = 800;
export const BANNER_HEIGHT = 200;

// Minimal hyperscript so we can build Satori's element tree without JSX.
type Node = SatoriElement | string | null | undefined;
interface SatoriElement {
  type: string;
  props: Record<string, unknown> & { children?: Node | Node[] };
}
function h(
  type: string,
  props: Record<string, unknown>,
  ...children: Node[]
): SatoriElement {
  const kids = children.flat().filter((c) => c != null && c !== '');
  // Satori requires an explicit display on any element with >1 child OR any
  // absolutely-positioned element (its own formatting context).
  const style = (props.style ?? {}) as Record<string, unknown>;
  const needsDisplay =
    type === 'div' &&
    style.display == null &&
    (kids.length > 1 || style.position != null);
  const nextProps = needsDisplay
    ? { ...props, style: { ...style, display: 'flex' } }
    : props;
  // Satori mis-handles an empty `children: []` (reports a bogus multi-child
  // error), so emit `undefined` for leaf nodes.
  const childProp =
    kids.length === 0 ? undefined : kids.length === 1 ? kids[0] : kids;
  return { type, props: { ...nextProps, children: childProp } };
}

function latencyColor(ms: number): string {
  if (ms < 80) return '#55ff55';
  if (ms < 200) return '#ffaa00';
  return '#ff6b6b';
}

/** Split MOTD spans into visual lines on embedded newlines (max 2 lines). */
function spansToLines(spans: MotdSpan[], maxLines = 2): MotdSpan[][] {
  const lines: MotdSpan[][] = [[]];
  for (const span of spans) {
    const parts = span.text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ ...span, text: part });
    });
  }
  return lines.filter((l) => l.length).slice(0, maxLines);
}

function motdElement(spans: MotdSpan[]): SatoriElement {
  const lines = spansToLines(spans);
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
    ...lines.map((line) =>
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'row' } },
        ...line.map((span) =>
          h(
            'span',
            {
              style: {
                color: span.color ?? '#ffffff',
                fontWeight: span.bold ? 700 : 400,
                fontStyle: span.italic ? 'italic' : 'normal',
                ...(span.underlined || span.strikethrough
                  ? {
                      textDecoration: [
                        span.underlined ? 'underline' : '',
                        span.strikethrough ? 'line-through' : '',
                      ]
                        .filter(Boolean)
                        .join(' '),
                    }
                  : {}),
                whiteSpace: 'pre',
              },
            },
            span.text,
          ),
        ),
      ),
    ),
  );
}

function iconElement(favicon: string | null): SatoriElement {
  if (favicon) {
    return h('img', {
      src: favicon,
      width: 128,
      height: 128,
      style: { borderRadius: 12 },
    });
  }
  return h(
    'div',
    {
      style: {
        display: 'flex',
        width: 128,
        height: 128,
        borderRadius: 12,
        background: '#3f8f3f',
        color: '#06210a',
        fontSize: 44,
        fontWeight: 700,
        alignItems: 'center',
        justifyContent: 'center',
      },
    },
    'MC',
  );
}

function statItem(label: string, value: string, color = '#e6e8eb'): SatoriElement {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column' } },
    h('span', { style: { fontSize: 12, color: '#8b94a3' } }, label),
    h('span', { style: { fontSize: 18, fontWeight: 700, color } }, value),
  );
}

interface BannerInput {
  host: string;
  port: number;
  status: ServerStatus | null;
}

function buildElement({ host, port, status }: BannerInput): SatoriElement {
  const online = !!status?.online;
  const motdSpans = status ? parseMotdSpans(status.motd.raw) : [];

  const header = h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      },
    },
    h('div', {
      style: {
        width: 12,
        height: 12,
        borderRadius: 6,
        background: online ? '#55ff55' : '#ff6b6b',
      },
    }),
    h(
      'span',
      { style: { fontSize: 28, fontWeight: 700, color: '#ffffff' } },
      `${host}${port !== 25565 ? `:${port}` : ''}`,
    ),
  );

  const body = online
    ? motdElement(motdSpans)
    : h(
        'span',
        { style: { fontSize: 22, fontWeight: 700, color: '#ff6b6b' } },
        '服务器离线',
      );

  const stats = h(
    'div',
    {
      style: { display: 'flex', flexDirection: 'row', gap: 28 },
    },
    statItem(
      '在线人数',
      online ? `${status!.players.online} / ${status!.players.max}` : '—',
    ),
    statItem('版本', online ? status!.version : '—'),
    statItem(
      '延迟',
      online ? `${status!.latency} ms` : '—',
      online ? latencyColor(status!.latency) : '#8b94a3',
    ),
  );

  const right = h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        height: 128,
        flex: 1,
        minWidth: 0,
      },
    },
    header,
    body,
    stats,
  );

  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'row',
        width: BANNER_WIDTH,
        height: BANNER_HEIGHT,
        padding: 28,
        gap: 24,
        alignItems: 'center',
        background: 'linear-gradient(135deg, #0d0f12 0%, #1d2128 100%)',
        fontFamily: FONT_FAMILY,
        color: '#e6e8eb',
      },
    },
    iconElement(status?.favicon ?? null),
    right,
    // brand watermark
    h(
      'div',
      {
        style: {
          position: 'absolute',
          right: 16,
          bottom: 12,
          fontSize: 12,
          color: '#5db85d',
        },
      },
      'MCSearch',
    ),
  );
}

export async function generateBanner(input: BannerInput): Promise<Buffer> {
  const fonts = await getFonts();
  const svg = await satori(buildElement(input), {
    width: BANNER_WIDTH,
    height: BANNER_HEIGHT,
    fonts,
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: BANNER_WIDTH },
  });
  return Buffer.from(resvg.render().asPng());
}
