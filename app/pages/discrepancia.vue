<script setup lang="ts">
import { RATEIO_CATEGORIAS_MAP, type RateioCategoriaCodigo } from '../constants/rateioCategorias'
import { competenciaFromInput, formatCurrencyBRL, formatDateBR } from '../utils/financeiro'

useHead({
  title: 'Discrepancia mensal'
})

interface PagamentoMensalRow {
  competencia: string
  baixa_erp_id: number | null
  filial: string | null
  fornecedor: string | null
  historico: string | null
  observacao: string | null
  complemento: string | null
  numero_titulo: string | null
  valor_pago: number | null
  data_baixa: string | null
  categoria_codigo: RateioCategoriaCodigo
}

type Situacao = 'sumiu' | 'novo' | 'variou' | 'estavel'

interface GrupoComparativo {
  chave: string
  fornecedor: string
  historico: string
  filiais: string[]
  anterior: PagamentoMensalRow[]
  atual: PagamentoMensalRow[]
  valorAnterior: number
  valorAtual: number
  diferenca: number
  percentual: number | null
  situacao: Situacao
}

const BATCH_SIZE = 1000
const supabase = useSupabaseClient()

function inputMesAnterior(value: string) {
  const [year, month] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 2, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function inputMesAtual() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// Por padrao abre no ultimo mes fechado.
const competenciaInput = ref(inputMesAnterior(inputMesAtual()))
const filialSelecionada = ref('todas')
const busca = ref('')
const filtroSituacao = ref<'todas' | Situacao>('todas')
const limitePercentual = ref(20)
const limiteValor = ref(500)
const carregando = ref(false)
const erro = ref('')
const linhasAtual = ref<PagamentoMensalRow[]>([])
const linhasAnterior = ref<PagamentoMensalRow[]>([])
const grupoAberto = ref<string | null>(null)

const competenciaAtual = computed(() => competenciaFromInput(competenciaInput.value))
const competenciaAnterior = computed(() => competenciaFromInput(inputMesAnterior(competenciaInput.value)))
const mesEmAberto = computed(() => competenciaInput.value >= inputMesAtual())

async function carregarCompetencia(competencia: string) {
  const linhas: PagamentoMensalRow[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('rateio_historico_classificacoes')
      .select('competencia, baixa_erp_id, filial, fornecedor, historico, observacao, complemento, numero_titulo, valor_pago, data_baixa, categoria_codigo')
      .eq('competencia', competencia)
      .order('id', { ascending: true })
      .range(from, from + BATCH_SIZE - 1)

    if (error) {
      throw error
    }

    const lote = (data as PagamentoMensalRow[] | null) ?? []
    linhas.push(...lote)

    if (lote.length < BATCH_SIZE) {
      break
    }

    from += BATCH_SIZE
  }

  return linhas
}

async function carregar() {
  if (!competenciaAtual.value) {
    return
  }

  carregando.value = true
  erro.value = ''
  grupoAberto.value = null

  try {
    const [atual, anterior] = await Promise.all([
      carregarCompetencia(competenciaAtual.value),
      carregarCompetencia(competenciaAnterior.value)
    ])
    linhasAtual.value = atual
    linhasAnterior.value = anterior
  }
  catch (caughtError) {
    erro.value = caughtError instanceof Error ? caughtError.message : 'Nao foi possivel carregar os dados.'
  }
  finally {
    carregando.value = false
  }
}

watch(competenciaInput, carregar)
onMounted(carregar)

function limpar(value: string | null | undefined) {
  return (value ?? '').trim().replace(/\s+/g, ' ')
}

function chaveGrupo(row: PagamentoMensalRow) {
  return `${limpar(row.fornecedor).toUpperCase()}||${limpar(row.historico).toUpperCase()}`
}

function somar(rows: PagamentoMensalRow[]) {
  return rows.reduce((total, row) => total + Number(row.valor_pago ?? 0), 0)
}

const filiaisDisponiveis = computed(() => {
  const filiais = new Set<string>()
  for (const row of [...linhasAtual.value, ...linhasAnterior.value]) {
    const filial = limpar(row.filial)
    if (filial) {
      filiais.add(filial)
    }
  }
  return [...filiais].sort()
})

function filtrarFilial(rows: PagamentoMensalRow[]) {
  if (filialSelecionada.value === 'todas') {
    return rows
  }
  return rows.filter((row) => limpar(row.filial) === filialSelecionada.value)
}

const atualFiltrado = computed(() => filtrarFilial(linhasAtual.value))
const anteriorFiltrado = computed(() => filtrarFilial(linhasAnterior.value))

const grupos = computed<GrupoComparativo[]>(() => {
  const mapa = new Map<string, GrupoComparativo>()

  const obterGrupo = (row: PagamentoMensalRow) => {
    const chave = chaveGrupo(row)
    let grupo = mapa.get(chave)
    if (!grupo) {
      grupo = {
        chave,
        fornecedor: limpar(row.fornecedor) || '(sem fornecedor)',
        historico: limpar(row.historico) || '(sem historico)',
        filiais: [],
        anterior: [],
        atual: [],
        valorAnterior: 0,
        valorAtual: 0,
        diferenca: 0,
        percentual: null,
        situacao: 'estavel'
      }
      mapa.set(chave, grupo)
    }
    const filial = limpar(row.filial)
    if (filial && !grupo.filiais.includes(filial)) {
      grupo.filiais.push(filial)
    }
    return grupo
  }

  for (const row of anteriorFiltrado.value) {
    obterGrupo(row).anterior.push(row)
  }
  for (const row of atualFiltrado.value) {
    obterGrupo(row).atual.push(row)
  }

  for (const grupo of mapa.values()) {
    grupo.valorAnterior = somar(grupo.anterior)
    grupo.valorAtual = somar(grupo.atual)
    grupo.diferenca = grupo.valorAtual - grupo.valorAnterior
    grupo.percentual = grupo.valorAnterior > 0 ? grupo.diferenca / grupo.valorAnterior : null

    if (grupo.anterior.length > 0 && grupo.atual.length === 0) {
      grupo.situacao = 'sumiu'
    }
    else if (grupo.anterior.length === 0 && grupo.atual.length > 0) {
      grupo.situacao = 'novo'
    }
    else if (
      Math.abs(grupo.diferenca) >= limiteValor.value
      && (grupo.percentual === null || Math.abs(grupo.percentual) * 100 >= limitePercentual.value)
    ) {
      grupo.situacao = 'variou'
    }
    else {
      grupo.situacao = 'estavel'
    }
  }

  return [...mapa.values()].sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca))
})

const contagemSituacao = computed(() => {
  const contagem: Record<'todas' | Situacao, number> = { todas: 0, sumiu: 0, novo: 0, variou: 0, estavel: 0 }
  for (const grupo of grupos.value) {
    contagem.todas++
    contagem[grupo.situacao]++
  }
  return contagem
})

const gruposVisiveis = computed(() => {
  const termo = busca.value.trim().toUpperCase()
  return grupos.value.filter((grupo) => {
    if (filtroSituacao.value !== 'todas' && grupo.situacao !== filtroSituacao.value) {
      return false
    }
    if (termo && !`${grupo.fornecedor} ${grupo.historico}`.toUpperCase().includes(termo)) {
      return false
    }
    return true
  })
})

const totalAnterior = computed(() => somar(anteriorFiltrado.value))
const totalAtual = computed(() => somar(atualFiltrado.value))
const variacaoTotal = computed(() => totalAtual.value - totalAnterior.value)
const variacaoTotalPct = computed(() => totalAnterior.value > 0 ? variacaoTotal.value / totalAnterior.value : null)

const semValorAtual = computed(() => atualFiltrado.value.filter((row) => row.valor_pago === null).length)
const semValorAnterior = computed(() => anteriorFiltrado.value.filter((row) => row.valor_pago === null).length)

const situacaoInfo: Record<Situacao, { label: string, classe: string }> = {
  sumiu: { label: 'Sumiu', classe: 'border-rose-400/30 bg-rose-400/15 text-rose-200' },
  novo: { label: 'Novo', classe: 'border-sky-400/30 bg-sky-400/15 text-sky-200' },
  variou: { label: 'Variou', classe: 'border-amber-400/30 bg-amber-400/15 text-amber-200' },
  estavel: { label: 'Estavel', classe: 'border-white/10 bg-white/5 text-slate-300' }
}

const abasSituacao: Array<{ codigo: 'todas' | Situacao, label: string }> = [
  { codigo: 'todas', label: 'Todos' },
  { codigo: 'sumiu', label: 'Sumiram' },
  { codigo: 'novo', label: 'Novos' },
  { codigo: 'variou', label: 'Variaram' },
  { codigo: 'estavel', label: 'Estaveis' }
]

function formatPercent(value: number | null) {
  if (value === null) {
    return '—'
  }
  const sinal = value > 0 ? '+' : ''
  return `${sinal}${(value * 100).toFixed(1).replace('.', ',')}%`
}

function formatDiferenca(value: number) {
  const sinal = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sinal}${formatCurrencyBRL(Math.abs(value))}`
}

function corDiferenca(value: number) {
  if (value > 0) return 'text-rose-300'
  if (value < 0) return 'text-emerald-300'
  return 'text-slate-400'
}

function alternarGrupo(chave: string) {
  grupoAberto.value = grupoAberto.value === chave ? null : chave
}

function ordenarPorData(rows: PagamentoMensalRow[]) {
  return [...rows].sort((a, b) => (a.data_baixa ?? '').localeCompare(b.data_baixa ?? ''))
}
</script>

<template>
  <main class="relative min-h-screen overflow-hidden bg-[#050816] text-slate-100">
    <div class="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.16),_transparent_25%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.18),_transparent_30%)]" />
    <div class="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.07)_1px,transparent_1px)] bg-[size:42px_42px] opacity-20" />

    <div class="relative mx-auto flex w-full max-w-[1920px] flex-col gap-8 px-3 py-10 sm:px-5 lg:px-6">
      <section class="rounded-[28px] border border-white/10 bg-slate-950/65 p-8 shadow-[0_30px_120px_rgba(0,0,0,0.35)] backdrop-blur">
        <div class="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div class="max-w-3xl space-y-3">
            <p class="text-sm font-semibold uppercase tracking-[0.35em] text-amber-300">
              Discrepancia mensal
            </p>
            <h1 class="text-4xl font-semibold tracking-tight text-white">
              {{ competenciaAtual || '--/----' }} comparado com {{ competenciaAnterior || '--/----' }}
            </h1>
            <p class="text-sm leading-7 text-slate-300">
              Pagamentos agrupados por fornecedor e historico: o que sumiu, o que apareceu e o que mudou de valor em relacao ao mes anterior.
            </p>
          </div>

          <NuxtLink
            to="/"
            class="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
          >
            ← Voltar ao rateio
          </NuxtLink>
        </div>
      </section>

      <section class="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 shadow-2xl shadow-black/20 backdrop-blur">
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-[220px_260px_1fr_160px_160px]">
          <label class="grid gap-2 text-sm font-medium text-slate-200">
            Competencia
            <input
              v-model="competenciaInput"
              type="month"
              class="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20"
            >
          </label>

          <label class="grid gap-2 text-sm font-medium text-slate-200">
            Filial
            <select
              v-model="filialSelecionada"
              class="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none transition focus:border-emerald-400"
            >
              <option value="todas">Todas as filiais</option>
              <option
                v-for="filial in filiaisDisponiveis"
                :key="filial"
                :value="filial"
              >
                {{ filial }}
              </option>
            </select>
          </label>

          <label class="grid gap-2 text-sm font-medium text-slate-200">
            Buscar
            <input
              v-model="busca"
              type="search"
              placeholder="Fornecedor ou historico..."
              class="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400"
            >
          </label>

          <label class="grid gap-2 text-sm font-medium text-slate-200">
            Alerta a partir de (%)
            <input
              v-model.number="limitePercentual"
              type="number"
              min="0"
              class="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none transition focus:border-emerald-400"
            >
          </label>

          <label class="grid gap-2 text-sm font-medium text-slate-200">
            e diferenca minima (R$)
            <input
              v-model.number="limiteValor"
              type="number"
              min="0"
              step="100"
              class="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none transition focus:border-emerald-400"
            >
          </label>
        </div>

        <div class="mt-4 flex flex-col gap-2 text-sm">
          <p
            v-if="mesEmAberto"
            class="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-amber-100"
          >
            {{ competenciaAtual }} ainda esta em aberto: os numeros sao parciais e a comparacao com o mes anterior nao e justa.
          </p>
          <p class="rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-slate-300">
            Fonte: titulos <strong class="text-slate-100">classificados e salvos</strong> no rateio
            ({{ atualFiltrado.length }} em {{ competenciaAtual }}, {{ anteriorFiltrado.length }} em {{ competenciaAnterior }}).
            Titulos nao classificados ainda nao entram nesta comparacao.
            <span
              v-if="semValorAtual || semValorAnterior"
              class="text-amber-300"
            >
              {{ semValorAtual + semValorAnterior }} registro(s) sem valor gravado.
            </span>
          </p>
          <p
            v-if="erro"
            class="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-rose-100"
          >
            {{ erro }}
          </p>
        </div>
      </section>

      <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <AppStatCard
          :label="`Total ${competenciaAnterior}`"
          :value="formatCurrencyBRL(totalAnterior)"
          tone="sky"
        />
        <AppStatCard
          :label="`Total ${competenciaAtual}`"
          :value="formatCurrencyBRL(totalAtual)"
          tone="emerald"
        />
        <AppStatCard
          label="Variacao"
          :value="`${formatDiferenca(variacaoTotal)} (${formatPercent(variacaoTotalPct)})`"
          :tone="variacaoTotal > 0 ? 'rose' : 'emerald'"
        />
        <AppStatCard
          label="Sumiram / Novos"
          :value="`${contagemSituacao.sumiu} / ${contagemSituacao.novo}`"
          tone="rose"
        />
        <AppStatCard
          label="Variaram acima do limite"
          :value="String(contagemSituacao.variou)"
          tone="amber"
        />
      </section>

      <section class="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 shadow-2xl shadow-black/20 backdrop-blur">
        <div class="mb-5 inline-flex flex-wrap gap-1 rounded-2xl border border-white/10 bg-slate-900/70 p-1">
          <button
            v-for="aba in abasSituacao"
            :key="aba.codigo"
            type="button"
            :class="[
              'rounded-xl px-4 py-2 text-sm font-semibold transition',
              filtroSituacao === aba.codigo ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'
            ]"
            @click="filtroSituacao = aba.codigo"
          >
            {{ aba.label }}
            <span class="ml-1 text-xs text-slate-500">{{ contagemSituacao[aba.codigo] }}</span>
          </button>
        </div>

        <div
          v-if="carregando"
          class="py-16 text-center text-slate-400"
        >
          Carregando...
        </div>

        <div
          v-else-if="gruposVisiveis.length === 0"
          class="py-16 text-center text-slate-400"
        >
          Nenhum fornecedor/historico encontrado para este filtro.
        </div>

        <div
          v-else
          class="overflow-x-auto rounded-2xl border border-white/10"
        >
          <table class="w-full min-w-[1100px] text-left text-sm">
            <thead class="bg-slate-900/80 text-slate-300">
              <tr>
                <th class="px-4 py-3 font-semibold">Fornecedor</th>
                <th class="px-4 py-3 font-semibold">Historico</th>
                <th class="px-4 py-3 text-right font-semibold">{{ competenciaAnterior }}</th>
                <th class="px-4 py-3 text-right font-semibold">{{ competenciaAtual }}</th>
                <th class="px-4 py-3 text-right font-semibold">Diferenca</th>
                <th class="px-4 py-3 text-right font-semibold">%</th>
                <th class="px-4 py-3 font-semibold">Situacao</th>
              </tr>
            </thead>
            <tbody>
              <template
                v-for="grupo in gruposVisiveis"
                :key="grupo.chave"
              >
                <tr
                  class="cursor-pointer border-t border-white/5 transition hover:bg-white/[0.03]"
                  @click="alternarGrupo(grupo.chave)"
                >
                  <td class="px-4 py-3">
                    <p class="font-semibold text-white">{{ grupo.fornecedor }}</p>
                    <p class="text-xs text-slate-500">{{ grupo.filiais.join(' · ') }}</p>
                  </td>
                  <td class="px-4 py-3 text-slate-300">{{ grupo.historico }}</td>
                  <td class="px-4 py-3 text-right text-slate-300">
                    {{ grupo.anterior.length ? formatCurrencyBRL(grupo.valorAnterior) : '—' }}
                    <p
                      v-if="grupo.anterior.length > 1"
                      class="text-xs text-slate-500"
                    >
                      {{ grupo.anterior.length }} titulos
                    </p>
                  </td>
                  <td class="px-4 py-3 text-right text-slate-100">
                    {{ grupo.atual.length ? formatCurrencyBRL(grupo.valorAtual) : '—' }}
                    <p
                      v-if="grupo.atual.length > 1"
                      class="text-xs text-slate-500"
                    >
                      {{ grupo.atual.length }} titulos
                    </p>
                  </td>
                  <td :class="['px-4 py-3 text-right font-semibold', corDiferenca(grupo.diferenca)]">
                    {{ formatDiferenca(grupo.diferenca) }}
                  </td>
                  <td :class="['px-4 py-3 text-right', corDiferenca(grupo.diferenca)]">
                    {{ formatPercent(grupo.percentual) }}
                  </td>
                  <td class="px-4 py-3">
                    <span :class="['rounded-full border px-3 py-1 text-xs font-semibold', situacaoInfo[grupo.situacao].classe]">
                      {{ situacaoInfo[grupo.situacao].label }}
                    </span>
                  </td>
                </tr>

                <tr
                  v-if="grupoAberto === grupo.chave"
                  class="border-t border-white/5 bg-slate-900/50"
                >
                  <td
                    colspan="7"
                    class="px-4 py-4"
                  >
                    <div class="grid gap-4 lg:grid-cols-2">
                      <div
                        v-for="lado in [
                          { titulo: competenciaAnterior, rows: grupo.anterior },
                          { titulo: competenciaAtual, rows: grupo.atual }
                        ]"
                        :key="lado.titulo"
                        class="rounded-2xl border border-white/10 bg-slate-950/60 p-4"
                      >
                        <p class="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                          {{ lado.titulo }} · {{ lado.rows.length }} titulo(s)
                        </p>
                        <p
                          v-if="lado.rows.length === 0"
                          class="text-slate-500"
                        >
                          Nenhum pagamento neste mes.
                        </p>
                        <table
                          v-else
                          class="w-full text-xs"
                        >
                          <thead class="text-slate-500">
                            <tr>
                              <th class="pb-2 text-left font-medium">Pagamento</th>
                              <th class="pb-2 text-left font-medium">Filial</th>
                              <th class="pb-2 text-left font-medium">Observacao</th>
                              <th class="pb-2 text-left font-medium">Destino</th>
                              <th class="pb-2 text-right font-medium">Valor</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr
                              v-for="(row, index) in ordenarPorData(lado.rows)"
                              :key="row.baixa_erp_id ?? index"
                              class="border-t border-white/5 align-top"
                            >
                              <td class="py-2 pr-3 text-slate-300">{{ formatDateBR(row.data_baixa) }}</td>
                              <td class="py-2 pr-3 text-slate-400">{{ row.filial || '-' }}</td>
                              <td class="py-2 pr-3 text-slate-400">{{ row.observacao || row.complemento || '-' }}</td>
                              <td class="py-2 pr-3 text-slate-400">{{ RATEIO_CATEGORIAS_MAP[row.categoria_codigo] ?? row.categoria_codigo }}</td>
                              <td class="py-2 text-right font-semibold text-slate-100">
                                {{ row.valor_pago === null ? 'sem valor' : formatCurrencyBRL(row.valor_pago) }}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </main>
</template>
