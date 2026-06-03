<script setup lang="ts">
defineProps<{
  label: string
  value: string
  tone?: 'emerald' | 'amber' | 'sky' | 'rose'
}>()

const toneClasses = {
  emerald: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
  amber: 'border-amber-500/20 bg-amber-500/10 text-amber-100',
  sky: 'border-sky-500/20 bg-sky-500/10 text-sky-100',
  rose: 'border-rose-500/20 bg-rose-500/10 text-rose-100'
}
</script>

<template>
  <div :class="['rounded-2xl border p-5 shadow-lg shadow-black/10', toneClasses[tone || 'emerald']]">
    <p class="text-xs font-semibold uppercase tracking-[0.25em]">
      {{ label }}
    </p>
    <p class="mt-3 text-2xl font-semibold text-white">
      {{ value }}
    </p>
  </div>
</template>
