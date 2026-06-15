<script setup lang="ts">
import { computed, ref } from 'vue';
import { API_ENDPOINTS } from '../../lib/api/catalog';
import ApiRunner from './ApiRunner.vue';

const selectedId = ref(API_ENDPOINTS[0].id);
const endpoint = computed(
  () => API_ENDPOINTS.find((e) => e.id === selectedId.value) ?? API_ENDPOINTS[0],
);
</script>

<template>
  <div class="grid gap-6 md:grid-cols-[220px_1fr]">
    <aside class="flex flex-col gap-1">
      <button
        v-for="ep in API_ENDPOINTS"
        :key="ep.id"
        type="button"
        class="rounded-lg px-3 py-2 text-left transition"
        :class="
          selectedId === ep.id
            ? 'bg-mc-surface-2 text-mc-text'
            : 'text-mc-muted hover:bg-mc-surface'
        "
        @click="selectedId = ep.id"
      >
        <div class="flex items-center gap-2 text-sm">
          <span class="font-mono text-[10px] text-mc-grass">{{ ep.method }}</span>
          <span>{{ ep.title }}</span>
        </div>
        <div class="mt-0.5 truncate font-mono text-[11px] text-mc-muted">
          {{ ep.path }}
        </div>
      </button>
    </aside>

    <section class="min-w-0">
      <div class="mb-4">
        <h2 class="text-lg font-semibold">{{ endpoint.title }}</h2>
        <p class="mt-1 text-sm text-mc-muted">{{ endpoint.summary }}</p>
      </div>
      <ApiRunner :key="endpoint.id" :endpoint="endpoint" />
    </section>
  </div>
</template>
