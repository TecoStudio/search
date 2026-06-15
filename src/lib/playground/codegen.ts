/**
 * Generate curl / JavaScript / Python request snippets for an API endpoint.
 */
import type { ApiEndpoint } from '../api/catalog';

export type SnippetLang = 'curl' | 'js' | 'python';

/** Shiki grammar id for each tab. */
export const SHIKI_LANG: Record<SnippetLang, string> = {
  curl: 'bash',
  js: 'javascript',
  python: 'python',
};

export const SNIPPET_LABEL: Record<SnippetLang, string> = {
  curl: 'curl',
  js: 'JavaScript',
  python: 'Python',
};

export function buildQuery(
  ep: ApiEndpoint,
  values: Record<string, string>,
): string {
  const sp = new URLSearchParams();
  for (const p of ep.params) {
    const v = values[p.name]?.trim();
    if (v) sp.set(p.name, v);
  }
  const q = sp.toString();
  return q ? `?${q}` : '';
}

export function buildUrl(
  base: string,
  ep: ApiEndpoint,
  values: Record<string, string>,
): string {
  return `${base}${ep.path}${buildQuery(ep, values)}`;
}

function fileName(ep: ApiEndpoint): string {
  return `${ep.id}.png`;
}

export function toCurl(
  base: string,
  ep: ApiEndpoint,
  values: Record<string, string>,
): string {
  const url = buildUrl(base, ep, values);
  if (ep.responseType === 'sse') return `curl -N "${url}"`;
  if (ep.responseType === 'image')
    return `curl "${url}" \\\n  --output ${fileName(ep)}`;
  return `curl "${url}"`;
}

export function toJs(
  base: string,
  ep: ApiEndpoint,
  values: Record<string, string>,
): string {
  const url = buildUrl(base, ep, values);
  if (ep.responseType === 'sse') {
    const handlers = (ep.events ?? ['message'])
      .map((evt) =>
        evt === 'result'
          ? `es.addEventListener("result", (e) => {\n  console.log(JSON.parse(e.data));\n  es.close();\n});`
          : evt === 'error'
            ? `es.addEventListener("error", () => es.close());`
            : `es.addEventListener("${evt}", (e) => console.log("${evt}:", e.data));`,
      )
      .join('\n');
    return `const es = new EventSource("${url}");\n${handlers}`;
  }
  if (ep.responseType === 'image') {
    return `const res = await fetch("${url}");\nconst blob = await res.blob();\nconst objectUrl = URL.createObjectURL(blob);\n// <img src={objectUrl} />`;
  }
  return `const res = await fetch("${url}");\nconst data = await res.json();\nconsole.log(data);`;
}

export function toPython(
  base: string,
  ep: ApiEndpoint,
  values: Record<string, string>,
): string {
  const url = buildUrl(base, ep, values);
  if (ep.responseType === 'sse') {
    return `import requests\n\nwith requests.get("${url}", stream=True) as r:\n    for line in r.iter_lines(decode_unicode=True):\n        if line:\n            print(line)`;
  }
  if (ep.responseType === 'image') {
    return `import requests\n\nr = requests.get("${url}")\nwith open("${fileName(ep)}", "wb") as f:\n    f.write(r.content)`;
  }
  return `import requests\n\nprint(requests.get("${url}").json())`;
}

export function generateSnippet(
  lang: SnippetLang,
  base: string,
  ep: ApiEndpoint,
  values: Record<string, string>,
): string {
  if (lang === 'curl') return toCurl(base, ep, values);
  if (lang === 'python') return toPython(base, ep, values);
  return toJs(base, ep, values);
}
