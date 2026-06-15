<script setup lang="ts">
/**
 * Knowledge card for the search results page. Fetches /api/v1/wiki/page for the
 * current query and renders thumbnail + title + intro extract. Renders nothing
 * when the query has no matching wiki page (the common case for a Mod query),
 * which is exactly the "exact/high match only" behaviour from the spec.
 */
import { ref, watch } from 'vue';
import { BookOpen, ExternalLink } from 'lucide-vue-next';

interface WikiPage {
  title: string;
  extract: string;
  thumbnail: string | null;
  url: string;
}

const props = defineProps<{ title: string }>();

const loading = ref(false);
const page = ref<WikiPage | null>(null);
let ctrl: AbortController | null = null;

async function load(title: string) {
  ctrl?.abort();
  page.value = null;
  const t = title.trim();
  if (!t) return;

  ctrl = new AbortController();
  loading.value = true;
  try {
    const res = await fetch(
      `/api/v1/wiki/page?title=${encodeURIComponent(t)}`,
      { signal: ctrl.signal },
    );
    if (!res.ok) return;
    const data = (await res.json()) as WikiPage | null;
    // Only show the card when we have a real extract to display.
    page.value = data && data.extract ? data : null;
  } catch {
    /* aborted or network error — leave card hidden */
  } finally {
    loading.value = false;
  }
}

watch(() => props.title, load, { immediate: true });
</script>

<template>
  <div
    v-if="loading || page"
    class="overflow-hidden rounded-xl border border-mc-border bg-mc-surface"
  >
    <!-- Loading skeleton -->
    <div v-if="loading && !page" class="animate-pulse space-y-3 p-4">
      <div class="h-32 w-full rounded-lg bg-mc-surface-2"></div>
      <div class="h-4 w-2/3 rounded bg-mc-surface-2"></div>
      <div class="h-3 w-full rounded bg-mc-surface-2"></div>
      <div class="h-3 w-5/6 rounded bg-mc-surface-2"></div>
    </div>

    <template v-else-if="page">
      <img
        v-if="page.thumbnail"
        :src="page.thumbnail"
        :alt="page.title"
        class="max-h-48 w-full bg-mc-surface-2 object-contain"
        loading="lazy"
      />
      <div class="p-4">
        <h2 class="text-lg font-bold leading-snug">{{ page.title }}</h2>
        <p class="mt-2 text-sm leading-relaxed text-mc-muted">
          {{ page.extract }}
        </p>

        <a
          :href="page.url"
          target="_blank"
          rel="noopener noreferrer"
          class="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-mc-grass px-3.5 py-2 text-sm font-semibold text-[#06210a] transition hover:bg-mc-grass-dark"
        >
          查看全文
          <ExternalLink class="size-3.5" :stroke-width="2.5" />
        </a>
      </div>

      <!-- Source attribution -->
      <div
        class="flex items-center gap-1.5 border-t border-mc-border px-4 py-2.5 text-xs text-mc-muted"
      >
        <BookOpen class="size-3.5 text-mc-grass" />
        来源：Minecraft Wiki
      </div>
    </template>
  </div>
</template>
