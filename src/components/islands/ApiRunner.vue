<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import type { ApiEndpoint } from '../../lib/api/catalog';
import { defaultValues } from '../../lib/api/catalog';
import {
  buildUrl,
  generateSnippet,
  SHIKI_LANG,
  SNIPPET_LABEL,
  type SnippetLang,
} from '../../lib/playground/codegen';
import { runRequest, type RunEvent, type RunResult } from '../../lib/playground/runner';
import { highlight } from '../../lib/playground/highlight';

const props = withDefaults(
  defineProps<{ endpoint: ApiEndpoint; compact?: boolean }>(),
  { compact: false },
);

const LANGS: SnippetLang[] = ['curl', 'js', 'python'];

const baseUrl = ref('');
const values = reactive<Record<string, string>>({});
const activeLang = ref<SnippetLang>('curl');
const codeHtml = ref('');
const copied = ref(false);

const running = ref(false);
const result = ref<RunResult | null>(null);
const events = ref<RunEvent[]>([]);
const resultHtml = ref('');
const bodyHtml = ref('');
const errorMsg = ref<string | null>(null);
let controller: AbortController | null = null;

function resetValues() {
  const defaults = defaultValues(props.endpoint);
  for (const k of Object.keys(values)) delete values[k];
  Object.assign(values, defaults);
}

const snippet = computed(() =>
  generateSnippet(activeLang.value, baseUrl.value, props.endpoint, values),
);

const missingRequired = computed(() =>
  props.endpoint.params.some((p) => p.required && !values[p.name]?.trim()),
);

async function refreshCode() {
  codeHtml.value = await highlight(snippet.value, SHIKI_LANG[activeLang.value]);
}

async function copy() {
  try {
    await navigator.clipboard.writeText(snippet.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    /* clipboard unavailable */
  }
}

async function highlightResult() {
  resultHtml.value = '';
  bodyHtml.value = '';
  const ep = props.endpoint;
  if (ep.responseType === 'sse') {
    const last = [...events.value].reverse().find((e) => e.event === 'result');
    if (last) {
      try {
        const pretty = JSON.stringify(JSON.parse(last.data), null, 2);
        resultHtml.value = await highlight(pretty, 'json');
      } catch {
        /* not json */
      }
    }
  } else if (result.value?.body) {
    try {
      const pretty = JSON.stringify(JSON.parse(result.value.body), null, 2);
      bodyHtml.value = await highlight(pretty, 'json');
    } catch {
      bodyHtml.value = '';
    }
  }
}

async function run() {
  if (missingRequired.value || running.value) return;
  controller?.abort();
  controller = new AbortController();
  running.value = true;
  errorMsg.value = null;
  result.value = null;
  events.value = [];
  resultHtml.value = '';
  bodyHtml.value = '';

  const url = buildUrl(baseUrl.value, props.endpoint, values);
  try {
    const res = await runRequest(url, props.endpoint.responseType, {
      signal: controller.signal,
      onEvent: (e) => events.value.push(e),
    });
    result.value = res;
    await highlightResult();
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      errorMsg.value = err instanceof Error ? err.message : String(err);
    }
  } finally {
    running.value = false;
  }
}

const headerEntries = computed(() =>
  Object.entries(result.value?.headers ?? {}).filter(([k]) =>
    [
      'x-cache',
      'x-response-time',
      'x-powered-by',
      'content-type',
      'cache-control',
      'access-control-allow-origin',
    ].includes(k),
  ),
);

onMounted(() => {
  baseUrl.value = window.location.origin;
  resetValues();
  refreshCode();
});

watch([activeLang, values, () => props.endpoint], () => {
  refreshCode();
});
watch(
  () => props.endpoint,
  () => {
    resetValues();
    result.value = null;
    events.value = [];
  },
);

onBeforeUnmount(() => controller?.abort());
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Param form -->
    <div class="grid gap-3 sm:grid-cols-2">
      <label v-for="p in endpoint.params" :key="p.name" class="flex flex-col gap-1">
        <span class="text-xs text-mc-muted">
          {{ p.name }}
          <span v-if="p.required" class="text-mc-gold">*</span>
          <span class="ml-1 opacity-70">— {{ p.description }}</span>
        </span>
        <select
          v-if="p.enum"
          v-model="values[p.name]"
          class="rounded-lg border border-mc-border bg-mc-surface px-3 py-1.5 text-sm outline-none focus:border-mc-grass"
        >
          <option v-for="opt in p.enum" :key="opt" :value="opt">{{ opt }}</option>
        </select>
        <input
          v-else
          v-model="values[p.name]"
          type="text"
          :placeholder="p.example ?? ''"
          autocomplete="off"
          spellcheck="false"
          class="rounded-lg border border-mc-border bg-mc-surface px-3 py-1.5 text-sm outline-none focus:border-mc-grass"
        />
      </label>
    </div>

    <!-- Code tabs -->
    <div class="overflow-hidden rounded-lg border border-mc-border">
      <div class="flex items-center justify-between border-b border-mc-border bg-mc-surface-2 px-2">
        <div class="flex">
          <button
            v-for="l in LANGS"
            :key="l"
            type="button"
            class="px-3 py-2 text-xs"
            :class="
              activeLang === l
                ? 'border-b-2 border-mc-grass text-mc-text'
                : 'text-mc-muted hover:text-mc-text'
            "
            @click="activeLang = l"
          >
            {{ SNIPPET_LABEL[l] }}
          </button>
        </div>
        <button
          type="button"
          class="mr-1 rounded px-2 py-1 text-xs text-mc-muted hover:text-mc-grass"
          @click="copy"
        >
          {{ copied ? '已复制 ✓' : '复制' }}
        </button>
      </div>
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div class="code-block overflow-x-auto bg-mc-surface px-3 py-2 text-sm" v-html="codeHtml"></div>
    </div>

    <!-- Run -->
    <div class="flex items-center gap-3">
      <button
        type="button"
        :disabled="running || missingRequired"
        class="rounded-lg bg-mc-grass px-4 py-1.5 text-sm font-semibold text-[#06210a] transition hover:bg-mc-grass-dark disabled:cursor-not-allowed disabled:opacity-50"
        @click="run"
      >
        {{ running ? '运行中…' : '运行' }}
      </button>
      <span v-if="result" class="text-xs text-mc-muted">
        {{ result.status }} · {{ Math.round(result.durationMs) }}ms
      </span>
    </div>

    <!-- Error -->
    <div
      v-if="errorMsg"
      class="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300"
    >
      {{ errorMsg }}
    </div>

    <!-- Response -->
    <div v-if="result" class="flex flex-col gap-3">
      <!-- Headers -->
      <div v-if="headerEntries.length" class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span v-for="[k, v] in headerEntries" :key="k" class="font-mono">
          <span class="text-mc-muted">{{ k }}:</span>
          <span
            :class="k === 'x-cache' && v === 'HIT' ? 'text-mc-grass' : 'text-mc-text'"
          >
            {{ v }}</span
          >
        </span>
      </div>

      <!-- SSE events -->
      <div v-if="result.type === 'sse'" class="flex flex-col gap-2">
        <div
          v-for="(e, i) in events"
          :key="i"
          class="flex gap-2 text-sm"
        >
          <span
            class="shrink-0 rounded px-1.5 py-0.5 text-xs font-mono"
            :class="{
              'bg-mc-surface-2 text-mc-muted': e.event === 'step',
              'bg-mc-grass/20 text-mc-grass': e.event === 'result',
              'bg-red-500/20 text-red-300': e.event === 'error',
            }"
            >{{ e.event }}</span
          >
          <span v-if="e.event !== 'result'" class="font-mono text-mc-muted">{{ e.data }}</span>
        </div>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div
          v-if="resultHtml"
          class="code-block overflow-x-auto rounded-lg border border-mc-border bg-mc-surface px-3 py-2 text-xs"
          v-html="resultHtml"
        ></div>
      </div>

      <!-- Image -->
      <div v-else-if="result.type === 'image'">
        <img
          :src="result.imageUrl"
          alt="response"
          class="max-w-full rounded-lg border border-mc-border"
        />
      </div>

      <!-- JSON / text -->
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div
        v-else-if="bodyHtml"
        class="code-block overflow-x-auto rounded-lg border border-mc-border bg-mc-surface px-3 py-2 text-xs"
        v-html="bodyHtml"
      ></div>
      <pre
        v-else-if="result.body"
        class="overflow-x-auto rounded-lg border border-mc-border bg-mc-surface px-3 py-2 text-xs"
        >{{ result.body }}</pre
      >
    </div>
  </div>
</template>

<style scoped>
.code-block :deep(pre) {
  margin: 0;
  background: transparent !important;
}
.code-block :deep(code) {
  font-family: var(--font-mono, ui-monospace, monospace);
}
</style>
