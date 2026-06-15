<script setup lang="ts">
/**
 * Search results page island. Owns the query state and composes:
 *   - the search box with the WikiSuggest autocomplete dropdown
 *   - result tabs (全部 / Wiki / Mod)
 *   - the wiki and mod search result lists
 *   - the WikiPanel knowledge card (right rail on desktop, top on mobile)
 *
 * Wiki and Mod search fire concurrently on submit, each with its own loading /
 * error state but sharing one AbortController so a new query cancels both.
 */
import { computed, onMounted, ref } from 'vue';
import {
  Search,
  BookOpen,
  Package,
  ExternalLink,
  Download,
  User,
} from 'lucide-vue-next';
import WikiSuggest from '../wiki/WikiSuggest.vue';
import WikiPanel from '../wiki/WikiPanel.vue';

interface WikiResult {
  title: string;
  titleSnippet: string;
  snippet: string;
  url: string;
}

interface ModResult {
  id: string;
  name: string;
  description: string;
  source: string;
  sourceName: string;
  url: string;
  thumbnail?: string;
  displayUrl: string;
  downloads?: number;
  author?: string;
  categories?: string[];
  projectType?: string;
}

const props = defineProps<{ initialQuery?: string }>();

type Tab = 'all' | 'wiki' | 'mod';
const TABS: Tab[] = ['all', 'wiki', 'mod'];

const input = ref(props.initialQuery ?? '');
const submitted = ref('');
const tab = ref<Tab>('all');

const loading = ref(false);
const error = ref<string | null>(null);
const results = ref<WikiResult[]>([]);

const modLoading = ref(false);
const modError = ref<string | null>(null);
const modResults = ref<ModResult[]>([]);

const focused = ref(false);
const suggestOpen = computed(() => focused.value && input.value.trim().length > 0);

let ctrl: AbortController | null = null;

async function runWiki(q: string, signal: AbortSignal) {
  loading.value = true;
  error.value = null;
  try {
    const res = await fetch(`/api/v1/wiki/search?q=${encodeURIComponent(q)}`, {
      signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? '搜索失败');
    results.value = data.results ?? [];
  } catch (err) {
    if (signal.aborted) return;
    error.value = err instanceof Error ? err.message : '搜索失败';
    results.value = [];
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}

async function runMod(q: string, signal: AbortSignal) {
  modLoading.value = true;
  modError.value = null;
  try {
    const res = await fetch(
      `/api/v1/mod/search?q=${encodeURIComponent(q)}&source=all`,
      { signal },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? '搜索失败');
    modResults.value = data.results ?? [];
  } catch (err) {
    if (signal.aborted) return;
    modError.value = err instanceof Error ? err.message : '搜索失败';
    modResults.value = [];
  } finally {
    if (!signal.aborted) modLoading.value = false;
  }
}

function runSearch(q: string) {
  ctrl?.abort();
  ctrl = new AbortController();
  runWiki(q, ctrl.signal);
  runMod(q, ctrl.signal);
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function submit() {
  const q = input.value.trim();
  if (!q) return;
  focused.value = false;
  submitted.value = q;
  // Keep the URL shareable / refresh-safe without spamming history.
  if (typeof window !== 'undefined') {
    window.history.replaceState({}, '', `/search?q=${encodeURIComponent(q)}`);
  }
  runSearch(q);
}

function breadcrumb(url: string): string {
  try {
    const u = new URL(url);
    const slug = decodeURIComponent(u.pathname.replace(/^\/w\//, '')).replace(
      /_/g,
      ' ',
    );
    return `${u.host} › ${slug}`;
  } catch {
    return 'zh.minecraft.wiki';
  }
}

onMounted(() => {
  if (submitted.value === '' && input.value.trim()) {
    submitted.value = input.value.trim();
    runSearch(submitted.value);
  }
});
</script>

<template>
  <div class="space-y-6">
    <!-- Search box -->
    <form class="relative" role="search" @submit.prevent="submit">
      <div
        class="flex items-center gap-2 rounded-full border border-mc-border bg-mc-surface px-5 py-2.5 transition focus-within:border-mc-grass"
      >
        <Search class="size-5 shrink-0 text-mc-muted" aria-hidden="true" />
        <input
          v-model="input"
          type="search"
          name="q"
          placeholder="搜索 Mod、整合包、Wiki 词条…"
          autocomplete="off"
          spellcheck="false"
          class="min-w-0 flex-1 bg-transparent py-1 text-base outline-none placeholder:text-mc-muted"
          @focus="focused = true"
          @blur="focused = false"
        />
        <button
          type="submit"
          class="shrink-0 rounded-full bg-mc-grass px-4 py-1.5 text-sm font-semibold text-[#06210a] transition hover:bg-mc-grass-dark"
        >
          搜索
        </button>
      </div>

      <!-- Autocomplete dropdown. mousedown.prevent keeps the input focused so
           the dropdown isn't torn down before an item's click fires. -->
      <div
        v-show="suggestOpen"
        class="absolute inset-x-0 top-full z-20 mt-2"
        @mousedown.prevent
      >
        <WikiSuggest :query="input" @select="focused = false" />
      </div>
    </form>

    <!-- Empty state -->
    <div
      v-if="!submitted"
      class="rounded-xl border border-dashed border-mc-border py-16 text-center text-sm text-mc-muted"
    >
      输入关键词，搜索 Minecraft Wiki 词条与 Mod。
    </div>

    <!-- Results -->
    <div v-else class="flex flex-col gap-6 lg:flex-row-reverse">
      <!-- Knowledge card: right rail on desktop, top on mobile -->
      <aside v-if="tab !== 'mod'" class="lg:w-80 lg:shrink-0">
        <WikiPanel :title="submitted" />
      </aside>

      <div class="min-w-0 flex-1 space-y-4">
        <!-- Tabs -->
        <div class="flex gap-1 border-b border-mc-border text-sm">
          <button
            v-for="t in TABS"
            :key="t"
            type="button"
            class="-mb-px border-b-2 px-3 py-2 font-medium transition"
            :class="
              tab === t
                ? 'border-mc-grass text-mc-text'
                : 'border-transparent text-mc-muted hover:text-mc-text'
            "
            @click="tab = t"
          >
            <span v-if="t === 'all'">全部</span>
            <span v-else-if="t === 'wiki'">Wiki{{ results.length ? ` (${results.length})` : '' }}</span>
            <span v-else>Mod{{ modResults.length ? ` (${modResults.length})` : '' }}</span>
          </button>
        </div>

        <!-- Wiki results -->
        <section v-if="tab === 'all' || tab === 'wiki'" class="space-y-3">
          <p v-if="loading" class="px-1 py-8 text-center text-sm text-mc-muted">
            搜索中…
          </p>
          <div
            v-else-if="error"
            class="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"
          >
            {{ error }}
          </div>
          <p
            v-else-if="tab === 'wiki' && !results.length"
            class="px-1 py-8 text-center text-sm text-mc-muted"
          >
            没有找到相关 Wiki 词条。
          </p>
          <a
            v-for="r in results"
            :key="r.url"
            :href="r.url"
            target="_blank"
            rel="noopener noreferrer"
            class="group block rounded-xl border border-mc-border bg-mc-surface p-4 transition hover:border-mc-grass/60"
          >
            <div class="flex items-center gap-1.5 text-xs text-mc-muted">
              <BookOpen class="size-3.5 shrink-0 text-mc-grass" />
              <span class="truncate">{{ breadcrumb(r.url) }}</span>
            </div>
            <h3
              class="mt-1 flex items-center gap-1.5 font-semibold text-mc-text group-hover:text-mc-grass"
            >
              <!-- eslint-disable-next-line vue/no-v-html -->
              <span class="wiki-snippet" v-html="r.titleSnippet"></span>
              <ExternalLink
                class="size-3.5 shrink-0 text-mc-muted opacity-0 transition group-hover:opacity-100"
              />
            </h3>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <p
              v-if="r.snippet"
              class="wiki-snippet mt-1 text-sm leading-relaxed text-mc-muted"
              v-html="r.snippet"
            ></p>
          </a>
        </section>

        <!-- Mod results -->
        <section v-if="tab === 'all' || tab === 'mod'" class="space-y-3">
          <p v-if="modLoading" class="px-1 py-8 text-center text-sm text-mc-muted">
            搜索中…
          </p>
          <div
            v-else-if="modError"
            class="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"
          >
            {{ modError }}
          </div>
          <p
            v-else-if="tab === 'mod' && !modResults.length"
            class="px-1 py-8 text-center text-sm text-mc-muted"
          >
            没有找到相关 Mod。
          </p>
          <a
            v-for="m in modResults"
            :key="m.id"
            :href="m.url"
            target="_blank"
            rel="noopener noreferrer"
            class="group flex gap-3 rounded-xl border border-mc-border bg-mc-surface p-4 transition hover:border-mc-grass/60"
          >
            <span
              class="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-mc-surface-2 text-mc-grass"
            >
              <img
                v-if="m.thumbnail"
                :src="m.thumbnail"
                :alt="m.name"
                class="size-full object-cover"
                loading="lazy"
              />
              <Package v-else class="size-5" />
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 text-xs text-mc-muted">
                <span
                  class="rounded bg-mc-surface-2 px-1.5 py-0.5 font-medium text-mc-grass"
                  >{{ m.sourceName }}</span
                >
                <span v-if="m.projectType" class="truncate">{{ m.projectType }}</span>
              </div>
              <h3
                class="mt-1 flex items-center gap-1.5 font-semibold text-mc-text group-hover:text-mc-grass"
              >
                <span class="truncate">{{ m.name }}</span>
                <ExternalLink
                  class="size-3.5 shrink-0 text-mc-muted opacity-0 transition group-hover:opacity-100"
                />
              </h3>
              <p
                v-if="m.description"
                class="mt-1 line-clamp-2 text-sm leading-relaxed text-mc-muted"
              >
                {{ m.description }}
              </p>
              <div
                v-if="m.downloads != null || m.author || m.categories?.length"
                class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mc-muted"
              >
                <span v-if="m.downloads != null" class="flex items-center gap-1">
                  <Download class="size-3.5" />{{ formatDownloads(m.downloads) }}
                </span>
                <span v-if="m.author" class="flex items-center gap-1">
                  <User class="size-3.5" />{{ m.author }}
                </span>
                <span v-if="m.categories?.length" class="truncate">{{
                  m.categories.slice(0, 3).join(' · ')
                }}</span>
              </div>
            </div>
          </a>
        </section>

        <!-- 全部 tab: a single empty message, only when nothing matched at all
             (each section hides its own placeholder outside its dedicated tab). -->
        <p
          v-if="
            tab === 'all' &&
            !loading &&
            !modLoading &&
            !error &&
            !modError &&
            !results.length &&
            !modResults.length
          "
          class="px-1 py-8 text-center text-sm text-mc-muted"
        >
          没有找到相关结果。
        </p>
      </div>
    </div>
  </div>
</template>
