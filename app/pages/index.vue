<script setup lang="ts">
const supabase = useSupabaseClient()

const { data: itens, error, status } = await useAsyncData('titulos-financeiros-pagos', async () => {
  const { data, error } = await supabase
    .from('titulos_financeiros_pagos')
    .select('*')
    .limit(5)

  if (error) {
    throw error
  }

  return data ?? []
})
</script>

<template>
  <main class="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
    <div class="mx-auto flex max-w-5xl flex-col gap-6">
      <header class="space-y-2">
        <p class="text-sm font-medium uppercase tracking-[0.3em] text-emerald-400">
          Teste de conexao
        </p>
        <h1 class="text-3xl font-semibold text-white">
          Supabase + Nuxt
        </h1>
        <p class="max-w-2xl text-sm text-slate-300">
          Esta pagina busca os 5 primeiros registros da tabela
          <code class="rounded bg-slate-800 px-2 py-1 text-emerald-300">titulos_financeiros_pagos</code>.
        </p>
      </header>

      <section class="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-black/20">
        <p
          v-if="status === 'pending'"
          class="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200"
        >
          Carregando dados do Supabase...
        </p>

        <p
          v-else-if="error"
          class="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          Falha ao consultar o Supabase: {{ error.message }}
        </p>

        <div
          v-else-if="!itens?.length"
          class="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
        >
          A consulta funcionou, mas a tabela nao retornou registros.
        </div>

        <div
          v-else
          class="overflow-hidden rounded-xl border border-slate-800"
        >
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-slate-800 text-sm">
              <thead class="bg-slate-800/80 text-left text-slate-300">
                <tr>
                  <th class="px-4 py-3 font-medium">
                    Registro
                  </th>
                  <th class="px-4 py-3 font-medium">
                    Conteudo
                  </th>
                </tr>
              </thead>

              <tbody class="divide-y divide-slate-800 bg-slate-900">
                <tr
                  v-for="(item, index) in itens"
                  :key="index"
                  class="align-top"
                >
                  <td class="px-4 py-4 text-slate-400">
                    #{{ index + 1 }}
                  </td>
                  <td class="px-4 py-4">
                    <pre class="whitespace-pre-wrap break-words text-xs leading-6 text-emerald-200">{{ JSON.stringify(item, null, 2) }}</pre>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
