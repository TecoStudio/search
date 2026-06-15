<script setup lang="ts">
/**
 * Autocomplete dropdown for the search box. Watches the `query` prop, debounces
 * 300ms, and lists up to 5 wiki title suggestions from /api/v1/wiki/suggest.
 *
 * Each suggestion carries a 「Wiki」badge so it can be visually distinguished
 * once Mod suggestions are merged into the same dropdown. Clicking a suggestion
 * opens the wiki page in a new tab and emits `select` so the parent can close
 * the dropdown.
 */
import { ref, watch, onBeforeUnmount } from 'vue';
import { BookOpen } from 'lucide-vue-next';

interface Suggestion {
  title: string;
  url: string;
}

const props = defineProps<{ query: string }>();
const emit = defineEmits<{ (e: 'select', s: Suggestion): void }>();

const suggestions = ref<Suggestion[]>([]);
let ctrl: AbortController | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

async function fetchSuggestions(q: string) {
  ctrl?.abort();
  ctrl = new AbortController();
  try {
    const res = await fetch(
      `/api/v1/wiki/suggest?q=${encodeURIComponent(q)}`,
      { signal: ctrl.signal },
    );
    if (!res.ok) return;
    const data = (await res.json()) as { suggestions: Suggestion[] };
    suggestions.value = data.suggestions ?? [];
  } catch {
    /* aborted or network error — keep previous list */
  }
}

watch(
  () => props.query,
  (q) => {
    if (timer) clearTimeout(timer);
    const trimmed = q.trim();
    if (!trimmed) {
      suggestions.value = [];
      ctrl?.abort();
      return;
    }
    timer = setTimeout(() => fetchSuggestions(trimmed), 300);
  },
);

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
  ctrl?.abort();
});
</script>

<template>
  <ul
    v-if="suggestions.length"
    class="overflow-hidden rounded-xl border border-mc-border bg-mc-surface shadow-lg"
  >
    <li v-for="s in suggestions" :key="s.url">
      <a
        :href="s.url"
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center gap-2.5 px-4 py-2.5 text-sm transition hover:bg-mc-surface-2"
        @click="emit('select', s)"
      >
        <BookOpen class="size-4 shrink-0 text-mc-muted" />
        <span class="min-w-0 flex-1 truncate">{{ s.title }}</span>
        <span
          class="shrink-0 rounded bg-mc-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-mc-grass"
          >Wiki</span
        >
      </a>
    </li>
  </ul>
</template>
