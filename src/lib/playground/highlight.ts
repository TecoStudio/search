/**
 * Lazy, singleton Shiki highlighter for the docs/playground islands.
 *
 * Uses the JavaScript regex engine (no runtime wasm fetch) and only the
 * grammars we need, so it stays scoped to the pages that import it.
 */
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import githubDark from 'shiki/themes/github-dark.mjs';
import bash from 'shiki/langs/bash.mjs';
import javascript from 'shiki/langs/javascript.mjs';
import python from 'shiki/langs/python.mjs';
import json from 'shiki/langs/json.mjs';

const THEME = 'github-dark';

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [githubDark],
      langs: [bash, javascript, python, json],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

export async function highlight(code: string, lang: string): Promise<string> {
  const hl = await getHighlighter();
  return hl.codeToHtml(code, {
    lang,
    theme: THEME,
    colorReplacements: { '#24292e': 'transparent' }, // let our panel bg show through
  });
}
