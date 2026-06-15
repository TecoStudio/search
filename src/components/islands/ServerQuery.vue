<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import { Check, Pickaxe } from 'lucide-vue-next';

interface PlayerSample {
  name: string;
  id: string;
}
interface ServerStatus {
  host: string;
  port: number;
  ip: string | null;
  online: boolean;
  latency: number;
  version: string;
  protocol: number;
  players: { online: number; max: number; sample: PlayerSample[] };
  motd: { raw: string; html: string; plain: string };
  favicon: string | null;
}

const STEPS = [
  { key: 'dns', label: 'DNS / SRV 解析' },
  { key: 'connecting', label: 'TCP 连接' },
  { key: 'handshake', label: '协议握手' },
] as const;

const host = ref('');
const port = ref('');
const edition = ref<'java' | 'bedrock' | 'auto'>('java');

const loading = ref(false);
const error = ref<string | null>(null);
const result = ref<ServerStatus | null>(null);
const stepState = reactive<Record<string, 'pending' | 'active' | 'done'>>({});

let es: EventSource | null = null;

const latencyClass = computed(() => {
  const ms = result.value?.latency ?? 0;
  if (ms < 80) return 'text-mc-grass';
  if (ms < 200) return 'text-mc-gold';
  return 'text-red-400';
});

function resetSteps() {
  for (const s of STEPS) stepState[s.key] = 'pending';
}

function closeStream() {
  if (es) {
    es.close();
    es = null;
  }
}

function markStep(key: string) {
  let reached = false;
  for (const s of STEPS) {
    if (s.key === key) {
      stepState[s.key] = 'active';
      reached = true;
    } else if (!reached) {
      stepState[s.key] = 'done';
    }
  }
}

function finishSteps() {
  for (const s of STEPS) stepState[s.key] = 'done';
}

function query() {
  const h = host.value.trim();
  if (!h || loading.value) return;

  closeStream();
  error.value = null;
  result.value = null;
  loading.value = true;
  resetSteps();

  const params = new URLSearchParams({ host: h, edition: edition.value });
  if (port.value.trim()) params.set('port', port.value.trim());

  es = new EventSource(`/api/v1/server/status?${params.toString()}`);

  es.addEventListener('step', (e) => {
    markStep((e as MessageEvent).data);
  });

  es.addEventListener('result', (e) => {
    result.value = JSON.parse((e as MessageEvent).data);
    finishSteps();
    loading.value = false;
    closeStream();
  });

  es.addEventListener('error', (e) => {
    const data = (e as MessageEvent).data;
    if (data) {
      // Server-sent named "error" event (carries a payload).
      try {
        error.value = JSON.parse(data).message ?? '查询失败';
      } catch {
        error.value = '查询失败';
      }
    } else if (loading.value) {
      // Native EventSource connection error (no payload) before a result.
      error.value = '连接服务器失败';
    } else {
      // Native error after completion = normal stream close; ignore.
      return;
    }
    loading.value = false;
    closeStream();
  });
}

onBeforeUnmount(closeStream);
</script>

<template>
  <div class="space-y-6">
    <form
      class="flex flex-col gap-3 sm:flex-row sm:items-end"
      @submit.prevent="query"
    >
      <label class="flex-1">
        <span class="mb-1 block text-xs text-mc-muted">服务器地址</span>
        <input
          v-model="host"
          type="text"
          placeholder="mc.hypixel.net"
          autocomplete="off"
          spellcheck="false"
          class="w-full rounded-lg border border-mc-border bg-mc-surface px-3 py-2 text-sm outline-none focus:border-mc-grass"
        />
      </label>
      <label class="sm:w-28">
        <span class="mb-1 block text-xs text-mc-muted">端口（可选）</span>
        <input
          v-model="port"
          type="text"
          inputmode="numeric"
          placeholder="自动"
          class="w-full rounded-lg border border-mc-border bg-mc-surface px-3 py-2 text-sm outline-none focus:border-mc-grass"
        />
      </label>
      <label class="sm:w-28">
        <span class="mb-1 block text-xs text-mc-muted">版本</span>
        <select
          v-model="edition"
          class="w-full rounded-lg border border-mc-border bg-mc-surface px-3 py-2 text-sm outline-none focus:border-mc-grass"
        >
          <option value="java">Java</option>
          <option value="bedrock">基岩版</option>
          <option value="auto">自动</option>
        </select>
      </label>
      <button
        type="submit"
        :disabled="loading || !host.trim()"
        class="rounded-lg bg-mc-grass px-5 py-2 text-sm font-semibold text-[#06210a] transition hover:bg-mc-grass-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        {{ loading ? '查询中…' : '查询' }}
      </button>
    </form>

    <!-- Progress steps -->
    <ol v-if="loading || result || error" class="flex flex-wrap gap-3 text-xs">
      <li
        v-for="s in STEPS"
        :key="s.key"
        class="flex items-center gap-1.5"
        :class="{
          'text-mc-grass': stepState[s.key] === 'done',
          'text-mc-gold': stepState[s.key] === 'active',
          'text-mc-muted': stepState[s.key] === 'pending',
        }"
      >
        <span
          class="grid size-4 place-items-center rounded-full border text-[10px]"
          :class="{
            'border-mc-grass bg-mc-grass text-[#06210a]':
              stepState[s.key] === 'done',
            'border-mc-gold': stepState[s.key] === 'active',
            'border-mc-border': stepState[s.key] === 'pending',
          }"
        >
          <Check v-if="stepState[s.key] === 'done'" class="size-3" :stroke-width="3" />
          <span v-else-if="stepState[s.key] === 'active'" class="animate-pulse"
            >•</span
          >
        </span>
        {{ s.label }}
      </li>
    </ol>

    <!-- Error -->
    <div
      v-if="error"
      class="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"
    >
      查询失败：{{ error }}
    </div>

    <!-- Result -->
    <div
      v-if="result"
      class="overflow-hidden rounded-xl border border-mc-border bg-mc-surface"
    >
      <div class="flex gap-4 p-4">
        <img
          v-if="result.favicon"
          :src="result.favicon"
          alt="server icon"
          width="64"
          height="64"
          class="size-16 shrink-0 rounded-lg"
        />
        <div
          v-else
          class="grid size-16 shrink-0 place-items-center rounded-lg bg-mc-surface-2 text-mc-muted"
        >
          <Pickaxe class="size-7" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span
              class="inline-block size-2 rounded-full"
              :class="result.online ? 'bg-mc-grass' : 'bg-red-500'"
            ></span>
            <span class="font-semibold">{{ result.host }}</span>
            <span class="text-xs text-mc-muted">:{{ result.port }}</span>
          </div>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="motd mt-1 text-sm" v-html="result.motd.html"></div>
        </div>
      </div>

      <dl
        class="grid grid-cols-2 gap-px border-t border-mc-border bg-mc-border text-sm sm:grid-cols-4"
      >
        <div class="bg-mc-surface px-4 py-3">
          <dt class="text-xs text-mc-muted">在线人数</dt>
          <dd class="mt-0.5 font-mono">
            {{ result.players.online }} / {{ result.players.max }}
          </dd>
        </div>
        <div class="bg-mc-surface px-4 py-3">
          <dt class="text-xs text-mc-muted">延迟</dt>
          <dd class="mt-0.5 font-mono" :class="latencyClass">
            {{ result.latency }} ms
          </dd>
        </div>
        <div class="bg-mc-surface px-4 py-3">
          <dt class="text-xs text-mc-muted">版本</dt>
          <dd class="mt-0.5 truncate font-mono" :title="result.version">
            {{ result.version }}
          </dd>
        </div>
        <div class="bg-mc-surface px-4 py-3">
          <dt class="text-xs text-mc-muted">IP</dt>
          <dd class="mt-0.5 truncate font-mono" :title="result.ip ?? ''">
            {{ result.ip ?? '—' }}
          </dd>
        </div>
      </dl>

      <div
        v-if="result.players.sample.length"
        class="flex flex-wrap gap-1.5 border-t border-mc-border p-4"
      >
        <span
          v-for="p in result.players.sample"
          :key="p.id || p.name"
          class="rounded bg-mc-surface-2 px-2 py-0.5 text-xs text-mc-muted"
        >
          {{ p.name }}
        </span>
      </div>
    </div>
  </div>
</template>
