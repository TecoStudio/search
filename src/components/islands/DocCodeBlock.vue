<script setup lang="ts">
import { computed } from 'vue';
import { getEndpoint } from '../../lib/api/catalog';
import ApiRunner from './ApiRunner.vue';

const props = defineProps<{ endpointId: string }>();
const endpoint = computed(() => getEndpoint(props.endpointId));
</script>

<template>
  <div
    v-if="endpoint"
    class="not-prose rounded-xl border border-mc-border bg-mc-surface/50 p-4"
  >
    <div class="mb-3 flex items-center gap-2 text-sm">
      <span
        class="rounded bg-mc-grass/20 px-2 py-0.5 font-mono text-xs text-mc-grass"
        >{{ endpoint.method }}</span
      >
      <code class="font-mono text-mc-text">{{ endpoint.path }}</code>
    </div>
    <ApiRunner :endpoint="endpoint" compact />
  </div>
  <div v-else class="text-sm text-red-300">未知接口：{{ endpointId }}</div>
</template>
