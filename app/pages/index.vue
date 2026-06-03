<script setup lang="ts">
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

import { RATEIO_CATEGORIAS, RATEIO_CATEGORIAS_MAP, type RateioCategoriaCodigo } from '../constants/rateioCategorias'
import type { ImportacaoTitulosApiResponse, TituloClassificacaoRow, TituloListItem, TituloPagoRow } from '../types/financeiro'
import {
  competenciaFromInput,
  formatCurrencyBRL,
  formatDateBR,
  getCompetenciaRange,
  getCurrentCompetenciaInput,
  normalizeText
} from '../utils/financeiro'

useHead({
  title: 'Rateio de Despesas'
})

type SortKey = 'fornecedor' | 'historico' | 'data_vencimento' | 'data_pagamento' | 'valor_pago'
type SortDirection = 'asc' | 'desc'

const LOCAL_STORAGE_COMPETENCIA_KEY = 'rateio_despesas_competencia'
const LOCAL_STORAGE_ULTIMA_IMPORTACAO_KEY = 'rateio_despesas_ultima_importacao'
const TITULOS_BATCH_SIZE = 1000
const TITULOS_POR_PAGINA = 100

const supabase = useSupabaseClient()

const competenciaInput = ref(getCurrentCompetenciaInput())
const busca = ref('')
const historicosSelecionados = ref<string[]>([])
const titulos = ref<TituloListItem[]>([])
const carregando = ref(false)
const importando = ref(false)
const salvando = ref(false)
const erro = ref('')
const sucesso = ref('')
const migrationAviso = ref('')
const ultimaImportacao = ref<string | null>(null)
const filtroHistoricosAberto = ref(false)
const buscaHistorico = ref('')
const sortKey = ref<SortKey>('valor_pago')
const sortDirection = ref<SortDirection>('desc')
const categoriaAbertaId = ref<number | null>(null)
const etapaImportacao = ref('Preparando a importacao...')
const detalheImportacao = ref('Estamos organizando a base para carregar os titulos da competencia selecionada.')
const paginaAtual = ref(1)
const classificacoesPendentes = ref(false)
const modalConfirmacaoImportacaoAberto = ref(false)
const telaInicializada = ref(false)

const competenciaFormatada = computed(() => competenciaFromInput(competenciaInput.value))

const historicosDisponiveis = computed(() => {
  const unicos = [...new Set(
    titulos.value
      .map((titulo) => normalizeText(titulo.historico))
      .filter((historico) => historico !== '-')
  )]

  return unicos.sort((a, b) => {
    const prioridadeA = getHistoricoPrioridade(a)
    const prioridadeB = getHistoricoPrioridade(b)

    if (prioridadeA !== prioridadeB) {
      return prioridadeA - prioridadeB
    }

    return a.localeCompare(b, 'pt-BR')
  })
})

const historicosFiltrados = computed(() => {
  const termo = sanitizeSearch(buscaHistorico.value)

  if (!termo) {
    return historicosDisponiveis.value
  }

  return historicosDisponiveis.value.filter((historico) => sanitizeSearch(historico).includes(termo))
})

const titulosFiltrados = computed(() => {
  const termo = sanitizeSearch(busca.value)

  const base = historicosSelecionados.value.length
    ? titulos.value.filter((titulo) => historicosSelecionados.value.includes(normalizeText(titulo.historico)))
    : titulos.value

  const filtrados = !termo
    ? base
    : base.filter((titulo) => {
      const categoria = titulo.categoriaCodigo ? RATEIO_CATEGORIAS_MAP[titulo.categoriaCodigo] : ''
      const textoBase = [
        titulo.fornecedor,
        titulo.historico,
        titulo.observacao,
        titulo.complemento,
        titulo.numero_titulo,
        titulo.sufixo,
        categoria
      ]
        .filter(Boolean)
        .join(' ')

      return sanitizeSearch(textoBase).includes(termo)
    })

  return [...filtrados].sort(compareTitulos)
})

const totalTitulos = computed(() => titulos.value.length)
const totalClassificados = computed(() => titulos.value.filter((titulo) => !!titulo.categoriaCodigo).length)
const totalPendentes = computed(() => totalTitulos.value - totalClassificados.value)
const valorTotalPago = computed(() => titulos.value.reduce((total, titulo) => total + Number(titulo.valor_pago ?? 0), 0))
const totalPaginas = computed(() => Math.max(1, Math.ceil(titulosFiltrados.value.length / TITULOS_POR_PAGINA)))
const titulosPaginados = computed(() => {
  const inicio = (paginaAtual.value - 1) * TITULOS_POR_PAGINA
  return titulosFiltrados.value.slice(inicio, inicio + TITULOS_POR_PAGINA)
})
const paginaInicial = computed(() => {
  if (!titulosFiltrados.value.length) {
    return 0
  }

  return ((paginaAtual.value - 1) * TITULOS_POR_PAGINA) + 1
})
const paginaFinal = computed(() => Math.min(paginaAtual.value * TITULOS_POR_PAGINA, titulosFiltrados.value.length))
const paginaAtualCompleta = computed(() => titulosPaginados.value.every((titulo) => !!titulo.categoriaCodigo))

const gruposRelatorio = computed(() =>
  RATEIO_CATEGORIAS.map((categoria) => {
    const itens = titulosFiltrados.value.filter((titulo) => titulo.categoriaCodigo === categoria.codigo)
    const total = itens.reduce((accumulator, item) => accumulator + Number(item.valor_pago ?? 0), 0)

    return {
      ...categoria,
      itens,
      total
    }
  }).filter((grupo) => grupo.itens.length > 0)
)

function sanitizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function getDataPagamento(titulo: TituloPagoRow) {
  return titulo.data_baixa || titulo.data_ultimo_pagamento
}

function getParcela(titulo: TituloPagoRow) {
  return normalizeText(titulo.sufixo || titulo.numero_titulo)
}

function resetMensagens() {
  erro.value = ''
  sucesso.value = ''
}

function compareTitulos(a: TituloListItem, b: TituloListItem) {
  const directionFactor = sortDirection.value === 'asc' ? 1 : -1

  switch (sortKey.value) {
    case 'fornecedor':
      return directionFactor * normalizeText(a.fornecedor).localeCompare(normalizeText(b.fornecedor), 'pt-BR')
    case 'historico':
      return directionFactor * normalizeText(a.historico).localeCompare(normalizeText(b.historico), 'pt-BR')
    case 'data_vencimento':
      return directionFactor * compareDates(a.data_vencimento, b.data_vencimento)
    case 'data_pagamento':
      return directionFactor * compareDates(getDataPagamento(a), getDataPagamento(b))
    case 'valor_pago':
      return directionFactor * ((Number(a.valor_pago ?? 0)) - (Number(b.valor_pago ?? 0)))
    default:
      return 0
  }
}

function compareDates(a: string | null | undefined, b: string | null | undefined) {
  const aTime = a ? new Date(a).getTime() : 0
  const bTime = b ? new Date(b).getTime() : 0

  return aTime - bTime
}

function getDefaultDirection(key: SortKey): SortDirection {
  if (key === 'valor_pago') {
    return 'desc'
  }

  return 'asc'
}

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
    return
  }

  sortKey.value = key
  sortDirection.value = getDefaultDirection(key)
}

function getSortIndicator(key: SortKey) {
  if (sortKey.value !== key) {
    return '↕'
  }

  return sortDirection.value === 'asc' ? '↑' : '↓'
}

function getHistoricoPrioridade(historico: string) {
  const normalizado = sanitizeSearch(historico)

  if (
    normalizado === 'pagamento fornecedor' ||
    normalizado === 'pagamento de fornecedor'
  ) {
    return 0
  }

  if (normalizado.includes('frete')) {
    return 1
  }

  return 2
}

function alternarHistorico(historico: string) {
  if (historicosSelecionados.value.includes(historico)) {
    historicosSelecionados.value = historicosSelecionados.value.filter((item) => item !== historico)
    return
  }

  historicosSelecionados.value = [...historicosSelecionados.value, historico]
}

function limparFiltroHistorico() {
  historicosSelecionados.value = []
}

function selecionarTodosHistoricos() {
  historicosSelecionados.value = [...historicosFiltrados.value]
}

function getCategoriaLabel(codigo: RateioCategoriaCodigo | null) {
  return codigo ? RATEIO_CATEGORIAS_MAP[codigo] : 'Selecione'
}

function alternarCategoriaAberta(tituloId: number) {
  categoriaAbertaId.value = categoriaAbertaId.value === tituloId ? null : tituloId
}

function selecionarCategoria(titulo: TituloListItem, categoriaCodigo: RateioCategoriaCodigo | null) {
  titulo.categoriaCodigo = categoriaCodigo
  categoriaAbertaId.value = null
  classificacoesPendentes.value = true
}

function shouldOpenCategoriaAcima(index: number, totalItens: number) {
  return index >= Math.max(totalItens - 3, 0)
}

async function irParaPagina(page: number) {
  const paginaDestino = Math.min(Math.max(1, page), totalPaginas.value)

  if (paginaDestino === paginaAtual.value) {
    return
  }

  if (paginaDestino > paginaAtual.value && !paginaAtualCompleta.value) {
    erro.value = 'Classifique todos os titulos desta pagina antes de continuar.'
    return
  }

  if (classificacoesPendentes.value) {
    const salvou = await salvarClassificacoes(true)

    if (!salvou) {
      return
    }
  }

  paginaAtual.value = paginaDestino
}

function solicitarImportacao() {
  if (importando.value) {
    return
  }

  if (titulos.value.length > 0) {
    modalConfirmacaoImportacaoAberto.value = true
    return
  }

  void importarTitulos()
}

async function confirmarNovaImportacao() {
  modalConfirmacaoImportacaoAberto.value = false
  await importarTitulos()
}

async function persistirCompetenciaAtual() {
  if (!import.meta.client) {
    return
  }

  localStorage.setItem(LOCAL_STORAGE_COMPETENCIA_KEY, competenciaInput.value)

  if (ultimaImportacao.value) {
    localStorage.setItem(LOCAL_STORAGE_ULTIMA_IMPORTACAO_KEY, ultimaImportacao.value)
  }
}

async function carregarTodosTitulos(startIso: string, endIso: string) {
  const todosTitulos: TituloPagoRow[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('titulos_financeiros_pagos')
      .select('id, fornecedor, historico, observacao, complemento, sufixo, numero_titulo, valor_pago, data_vencimento, data_baixa, data_ultimo_pagamento')
      .gte('data_baixa', startIso)
      .lt('data_baixa', endIso)
      .order('data_baixa', { ascending: true })
      .order('fornecedor', { ascending: true })
      .range(from, from + TITULOS_BATCH_SIZE - 1)

    if (error) {
      throw error
    }

    const lote = (data as TituloPagoRow[] | null) ?? []
    todosTitulos.push(...lote)

    if (lote.length < TITULOS_BATCH_SIZE) {
      break
    }

    from += TITULOS_BATCH_SIZE
  }

  return todosTitulos
}

function ajustarPaginacao() {
  if (paginaAtual.value > totalPaginas.value) {
    paginaAtual.value = totalPaginas.value
  }

  if (paginaAtual.value < 1) {
    paginaAtual.value = 1
  }
}

async function carregarTitulos(exibirLoading = true) {
  if (!competenciaFormatada.value) {
    erro.value = 'Selecione uma competencia valida.'
    return
  }

  resetMensagens()

  if (exibirLoading) {
    carregando.value = true
  }

  migrationAviso.value = ''

  try {
    const { startIso, endIso } = getCompetenciaRange(competenciaInput.value)
    const data = await carregarTodosTitulos(startIso, endIso)

    const classificacaoMap = new Map<number, RateioCategoriaCodigo>()
    const { data: classificacoes, error: classificacaoError } = await supabase
      .from('titulo_pago_classificacoes')
      .select('titulo_pago_id, categoria_codigo, competencia')
      .eq('competencia', competenciaFormatada.value)

    if (classificacaoError) {
      if (isMissingTableError(classificacaoError.message)) {
        migrationAviso.value = 'A tabela de classificacoes ainda nao existe no Supabase. Rode a migration antes de salvar os apontamentos.'
      }
      else {
        throw classificacaoError
      }
    }

    for (const classificacao of (classificacoes as TituloClassificacaoRow[] | null) ?? []) {
      classificacaoMap.set(classificacao.titulo_pago_id, classificacao.categoria_codigo)
    }

    titulos.value = ((data as TituloPagoRow[] | null) ?? []).map((titulo) => ({
      ...titulo,
      categoriaCodigo: classificacaoMap.get(titulo.id) ?? null
    }))
    classificacoesPendentes.value = false
    ajustarPaginacao()
  }
  catch (caughtError) {
    erro.value = getErrorMessage(caughtError, 'Nao foi possivel carregar os titulos dessa competencia.')
  }
  finally {
    carregando.value = false
  }
}

async function importarTitulos() {
  if (!competenciaFormatada.value) {
    erro.value = 'Selecione uma competencia valida.'
    return
  }

  importando.value = true
  etapaImportacao.value = 'Importando titulos do ERP Solidus...'
  detalheImportacao.value = `Limpando a base anterior e carregando os titulos da competencia ${competenciaFormatada.value}.`
  resetMensagens()

  try {
    const response = await $fetch<ImportacaoTitulosApiResponse>('/api/importar-titulos', {
      method: 'POST',
      body: {
        competencia: competenciaFormatada.value
      }
    })

    etapaImportacao.value = 'Atualizando a lista de titulos...'
    detalheImportacao.value = 'Isso costuma levar so alguns instantes. Enquanto finalizamos, pode pegar uma agua ou um cafe.'

    await carregarTitulos(false)

    ultimaImportacao.value = new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date())
    await persistirCompetenciaAtual()

    const totalImportado = response.totalImportado || titulos.value.length
    sucesso.value = `${totalImportado} titulo(s) importado(s) com sucesso para ${response.competencia}.`
  }
  catch (caughtError) {
    erro.value = getErrorMessage(caughtError, 'Nao foi possivel acionar o webhook do n8n.')
  }
  finally {
    importando.value = false
  }
}

async function salvarClassificacoes(silencioso = false) {
  if (!titulos.value.length) {
    erro.value = 'Nao ha titulos carregados para salvar.'
    return false
  }

  if (migrationAviso.value) {
    erro.value = 'Rode a migration da tabela de classificacoes no Supabase antes de salvar.'
    return false
  }

  salvando.value = true

  if (!silencioso) {
    resetMensagens()
  }

  try {
    const classificacoes = titulos.value
      .filter((titulo): titulo is TituloListItem & { categoriaCodigo: RateioCategoriaCodigo } => !!titulo.categoriaCodigo)
      .map((titulo) => ({
        titulo_pago_id: titulo.id,
        competencia: competenciaFormatada.value,
        categoria_codigo: titulo.categoriaCodigo
      }))

    const idsSemCategoria = titulos.value.filter((titulo) => !titulo.categoriaCodigo).map((titulo) => titulo.id)

    if (classificacoes.length > 0) {
      const { error } = await supabase
        .from('titulo_pago_classificacoes')
        .upsert(classificacoes, { onConflict: 'titulo_pago_id' })

      if (error) {
        throw error
      }
    }

    if (idsSemCategoria.length > 0) {
      const { error } = await supabase
        .from('titulo_pago_classificacoes')
        .delete()
        .eq('competencia', competenciaFormatada.value)
        .in('titulo_pago_id', idsSemCategoria)

      if (error) {
        throw error
      }
    }

    classificacoesPendentes.value = false

    if (!silencioso) {
      sucesso.value = 'Classificacoes salvas com sucesso.'
    }

    await carregarTitulos(false)
    return true
  }
  catch (caughtError) {
    erro.value = getErrorMessage(caughtError, 'Nao foi possivel salvar as classificacoes.')
    return false
  }
  finally {
    salvando.value = false
  }
}

function exportarPdf() {
  if (!gruposRelatorio.value.length) {
    erro.value = 'Classifique ao menos um titulo antes de gerar o PDF.'
    return
  }

  resetMensagens()

  const doc = new jsPDF({
    unit: 'pt',
    format: 'a4'
  })

  const marginX = 40
  const generatedAt = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date())

  doc.setFillColor(7, 11, 34)
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 110, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(24)
  doc.text('Relatorio de Rateio de Despesas', marginX, 48)
  doc.setFontSize(11)
  doc.text(`Competencia: ${competenciaFormatada.value}`, marginX, 72)
  doc.text(`Gerado em: ${generatedAt}`, marginX, 90)

  autoTable(doc, {
    startY: 135,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    head: [['Categoria', 'Titulos', 'Valor total']],
    body: gruposRelatorio.value.map((grupo) => [
      grupo.label,
      String(grupo.itens.length),
      formatCurrencyBRL(grupo.total)
    ]),
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [248, 250, 252]
    },
    bodyStyles: {
      textColor: [15, 23, 42],
      fontSize: 10
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252]
    }
  })

  let currentY = ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 170) + 28

  for (const grupo of gruposRelatorio.value) {
    if (currentY > 660) {
      doc.addPage()
      currentY = 50
    }

    doc.setTextColor(15, 23, 42)
    doc.setFontSize(15)
    doc.text(grupo.label, marginX, currentY)

    autoTable(doc, {
      startY: currentY + 14,
      margin: { left: marginX, right: marginX },
      theme: 'striped',
      head: [['Fornecedor', 'Historico', 'Parcela', 'Vencimento', 'Pagamento', 'Valor pago']],
      body: grupo.itens.map((titulo) => [
        normalizeText(titulo.fornecedor),
        [normalizeText(titulo.historico), normalizeText(titulo.observacao), normalizeText(titulo.complemento)]
          .filter((value) => value !== '-')
          .join('\n'),
        getParcela(titulo),
        formatDateBR(titulo.data_vencimento),
        formatDateBR(getDataPagamento(titulo)),
        formatCurrencyBRL(titulo.valor_pago)
      ]),
      styles: {
        fontSize: 8.5,
        cellPadding: 5,
        overflow: 'linebreak',
        textColor: [30, 41, 59]
      },
      headStyles: {
        fillColor: [22, 101, 52],
        textColor: [255, 255, 255]
      },
      columnStyles: {
        0: { cellWidth: 105 },
        1: { cellWidth: 175 },
        2: { cellWidth: 55 },
        3: { cellWidth: 60 },
        4: { cellWidth: 60 },
        5: { cellWidth: 75, halign: 'right' }
      }
    })

    currentY = ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? currentY) + 28
  }

  doc.save(`relatorio-rateio-${competenciaFormatada.value.replace('/', '-')}.pdf`)
}

function isMissingTableError(message: string) {
  const lowered = message.toLowerCase()

  return (
    lowered.includes('could not find the table') ||
    lowered.includes('schema cache') ||
    lowered.includes('relation') ||
    lowered.includes('does not exist')
  )
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message || fallback
  }

  if (typeof error === 'object' && error !== null && 'data' in error) {
    return String((error as { data?: { message?: string } }).data?.message || fallback)
  }

  return fallback
}

function fecharMenus() {
  categoriaAbertaId.value = null
  filtroHistoricosAberto.value = false
}

onMounted(async () => {
  document.addEventListener('click', fecharMenus)
  const competenciaSalva = import.meta.client ? localStorage.getItem(LOCAL_STORAGE_COMPETENCIA_KEY) : null
  const ultimaImportacaoSalva = import.meta.client ? localStorage.getItem(LOCAL_STORAGE_ULTIMA_IMPORTACAO_KEY) : null

  if (competenciaSalva) {
    competenciaInput.value = competenciaSalva
  }

  if (ultimaImportacaoSalva) {
    ultimaImportacao.value = ultimaImportacaoSalva
  }

  await carregarTitulos()
  telaInicializada.value = true
})

onBeforeUnmount(() => {
  document.removeEventListener('click', fecharMenus)
})

watch(competenciaInput, async (value, oldValue) => {
  if (!import.meta.client) {
    return
  }

  localStorage.setItem(LOCAL_STORAGE_COMPETENCIA_KEY, value)

  if (!telaInicializada.value || value === oldValue || importando.value) {
    return
  }

  await carregarTitulos()
})

watch([busca, historicosSelecionados], () => {
  paginaAtual.value = 1
}, { deep: true })

watch(totalPaginas, () => {
  ajustarPaginacao()
})
</script>

<template>
  <main class="relative min-h-screen overflow-hidden bg-[#050816] text-slate-100">
    <div class="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.16),_transparent_25%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.18),_transparent_30%)]" />
    <div class="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.07)_1px,transparent_1px)] bg-[size:42px_42px] opacity-20" />

    <div class="relative mx-auto flex max-w-7xl flex-col gap-8 px-6 py-10 lg:px-10">
      <section class="rounded-[28px] border border-white/10 bg-slate-950/65 p-8 shadow-[0_30px_120px_rgba(0,0,0,0.35)] backdrop-blur">
        <div class="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div class="max-w-3xl space-y-4">
            <p class="text-sm font-semibold uppercase tracking-[0.35em] text-emerald-300">
              Rateio de despesas
            </p>
            <div class="space-y-3">
              <h1 class="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Importe os titulos pagos, classifique por loja e gere um PDF apresentavel.
              </h1>
              <p class="max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                Centralize a importacao dos titulos do ERP Solidus, organize a distribuicao das despesas e gere um relatorio final pronto para apresentacao.
              </p>
            </div>
          </div>

          <div class="grid gap-3 rounded-3xl border border-emerald-500/20 bg-emerald-500/10 p-5 text-sm text-emerald-100 sm:min-w-[320px]">
            <p class="font-semibold uppercase tracking-[0.2em] text-emerald-300">
              Fluxo
            </p>
            <p>1. Escolha a competencia.</p>
            <p>2. Importe os titulos do ERP Solidus.</p>
            <p>3. Classifique cada titulo em um destino.</p>
            <p>4. Gere e baixe o relatorio final em PDF.</p>
          </div>
        </div>
      </section>

      <section class="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 shadow-2xl shadow-black/20 backdrop-blur">
        <div class="flex flex-col gap-6">
          <div class="flex flex-col gap-3">
            <p class="text-sm font-semibold uppercase tracking-[0.28em] text-sky-300">
              Importacao mensal
            </p>
            <h2 class="text-2xl font-semibold text-white">
              Competencia e atualizacao dos titulos
            </h2>
            <p class="max-w-2xl text-sm text-slate-300">
              Escolha o periodo que deseja importar e atualize a base com os titulos pagos vindos do ERP Solidus.
            </p>
          </div>

          <div class="grid gap-4 md:grid-cols-[minmax(0,220px)_1fr]">
            <label class="grid gap-2 text-sm font-medium text-slate-200">
              Competencia
              <input
                v-model="competenciaInput"
                type="month"
                class="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20"
              >
            </label>

            <div class="flex flex-col justify-end gap-3 sm:flex-row">
              <button
                type="button"
                class="inline-flex items-center justify-center rounded-2xl border border-emerald-400/30 bg-emerald-400/15 px-5 py-3 text-sm font-semibold text-emerald-100 transition hover:border-emerald-300 hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="importando"
                @click="solicitarImportacao"
              >
                {{
                  importando
                    ? 'Importando titulos...'
                    : totalTitulos
                      ? 'Importar nova competencia'
                      : 'Importar titulos do ERP Solidus'
                }}
              </button>
            </div>
          </div>

          <div class="rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-slate-300">
            Periodo selecionado para importacao:
            <span class="font-semibold text-emerald-300">{{ competenciaFormatada || '--/----' }}</span>
            <span
              v-if="ultimaImportacao"
              class="ml-2 text-slate-400"
            >
              | Ultima atualizacao: {{ ultimaImportacao }}
            </span>
          </div>
        </div>
      </section>

      <div
        v-if="erro"
        class="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 text-sm text-rose-100"
      >
        {{ erro }}
      </div>

      <div
        v-if="sucesso"
        class="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-100"
      >
        {{ sucesso }}
      </div>

      <div
        v-if="migrationAviso"
        class="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-sm text-amber-100"
      >
        {{ migrationAviso }}
      </div>

      <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AppStatCard
          label="Titulos carregados"
          :value="String(totalTitulos)"
          tone="emerald"
        />
        <AppStatCard
          label="Classificados"
          :value="String(totalClassificados)"
          tone="sky"
        />
        <AppStatCard
          label="Pendentes"
          :value="String(totalPendentes)"
          tone="amber"
        />
        <AppStatCard
          label="Valor total pago"
          :value="formatCurrencyBRL(valorTotalPago)"
          tone="rose"
        />
      </section>

      <section class="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 shadow-2xl shadow-black/20 backdrop-blur">
        <div class="flex flex-col gap-6">
          <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div class="space-y-2">
              <p class="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-300">
                Classificacao
              </p>
              <h2 class="text-2xl font-semibold text-white">
                Tabela de apontamento por titulo
              </h2>
            </div>

            <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div class="relative">
                <button
                  type="button"
                  class="inline-flex min-w-[260px] items-center justify-between rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white transition hover:bg-slate-900 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/20"
                  @click.stop
                  @click="filtroHistoricosAberto = !filtroHistoricosAberto"
                >
                  <span class="truncate text-left">
                    {{
                      historicosSelecionados.length
                        ? `${historicosSelecionados.length} historico(s) selecionado(s)`
                        : 'Filtrar por historico'
                    }}
                  </span>
                  <span class="text-slate-400">{{ filtroHistoricosAberto ? '▲' : '▼' }}</span>
                </button>

                <div
                  v-if="filtroHistoricosAberto"
                  class="absolute left-0 top-[calc(100%+0.5rem)] z-20 w-[420px] max-w-[90vw] rounded-2xl border border-white/10 bg-slate-950/95 p-4 shadow-2xl shadow-black/30 backdrop-blur"
                  @click.stop
                >
                  <div class="mb-3 flex items-center justify-between">
                    <p class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      Historicos
                    </p>
                    <div class="flex items-center gap-3">
                      <button
                        type="button"
                        class="text-xs font-medium text-sky-300 transition hover:text-sky-200"
                        @click="selecionarTodosHistoricos"
                      >
                        Selecionar todos
                      </button>
                      <button
                        type="button"
                        class="text-xs font-medium text-emerald-300 transition hover:text-emerald-200"
                        @click="limparFiltroHistorico"
                      >
                        Limpar
                      </button>
                    </div>
                  </div>

                  <input
                    v-model="buscaHistorico"
                    type="text"
                    placeholder="Buscar historico..."
                    class="mb-3 w-full rounded-xl border border-white/10 bg-slate-900/90 px-3 py-2.5 text-sm text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20"
                  >

                  <div class="max-h-80 space-y-2 overflow-y-auto pr-1">
                    <label
                      v-for="historico in historicosFiltrados"
                      :key="historico"
                      class="flex cursor-pointer items-start gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-sm text-slate-200 transition hover:bg-white/[0.06]"
                    >
                      <input
                        :checked="historicosSelecionados.includes(historico)"
                        type="checkbox"
                        class="mt-1 h-4 w-4 rounded border-white/20 bg-slate-900 text-emerald-400 focus:ring-emerald-400/30"
                        @change="alternarHistorico(historico)"
                      >
                      <span class="leading-6">{{ historico }}</span>
                    </label>

                    <div
                      v-if="!historicosFiltrados.length"
                      class="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-4 text-sm text-slate-400"
                    >
                      Nenhum historico encontrado para essa busca.
                    </div>
                  </div>
                </div>
              </div>

              <input
                v-model="busca"
                type="text"
                placeholder="Buscar fornecedor, historico, parcela..."
                class="min-w-[280px] rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20"
              >

              <button
                type="button"
                class="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="salvando || !totalTitulos"
                @click="salvarClassificacoes"
              >
                {{ salvando ? 'Salvando...' : 'Salvar classificacoes' }}
              </button>
            </div>
          </div>

          <div
            v-if="carregando"
            class="rounded-2xl border border-sky-500/20 bg-sky-500/10 px-5 py-12 text-center text-sm text-sky-100"
          >
            Carregando titulos dessa competencia...
          </div>

          <div
            v-else-if="!totalTitulos"
            class="rounded-2xl border border-white/10 bg-slate-900/60 px-5 py-12 text-center text-sm text-slate-300"
          >
            Nenhum titulo encontrado para a competencia {{ competenciaFormatada || '--/----' }}.
          </div>

          <div
            v-else
            class="overflow-hidden rounded-3xl border border-white/10 bg-slate-900/70"
          >
            <div class="border-b border-white/10 bg-slate-900/90 px-4 py-3 text-sm text-slate-300">
              Exibindo
              <span class="font-semibold text-white">{{ paginaInicial }}</span>
              a
              <span class="font-semibold text-white">{{ paginaFinal }}</span>
              de
              <span class="font-semibold text-white">{{ titulosFiltrados.length }}</span>
              titulo(s)
              <span v-if="historicosSelecionados.length">
                com filtro de historico aplicado
              </span>
            </div>
            <div class="overflow-x-auto xl:overflow-visible">
              <table class="min-w-full table-fixed text-left text-sm">
                <colgroup>
                  <col class="w-[14%]">
                  <col class="w-[12%]">
                  <col class="w-[18%]">
                  <col class="w-[6%]">
                  <col class="w-[9%]">
                  <col class="w-[9%]">
                  <col class="w-[8%]">
                  <col class="w-[24%]">
                </colgroup>
                <thead class="bg-slate-800/90 text-slate-300">
                  <tr>
                        <th class="px-4 py-4 font-medium">
                          <button
                            type="button"
                            class="inline-flex items-center gap-2 transition hover:text-white"
                            @click="toggleSort('fornecedor')"
                          >
                            <span>Fornecedor</span>
                            <span class="text-xs text-slate-500">{{ getSortIndicator('fornecedor') }}</span>
                          </button>
                        </th>
                        <th class="px-4 py-4 font-medium">
                          <button
                            type="button"
                            class="inline-flex items-center gap-2 transition hover:text-white"
                            @click="toggleSort('historico')"
                          >
                            <span>Historico</span>
                            <span class="text-xs text-slate-500">{{ getSortIndicator('historico') }}</span>
                          </button>
                        </th>
                        <th class="px-4 py-4 font-medium">
                          Observacao / Complemento
                        </th>
                        <th class="px-4 py-4 font-medium">
                          Parcela
                        </th>
                        <th class="px-4 py-4 font-medium">
                          <button
                            type="button"
                            class="inline-flex items-center gap-2 transition hover:text-white"
                            @click="toggleSort('data_vencimento')"
                          >
                            <span>Vencimento</span>
                            <span class="text-xs text-slate-500">{{ getSortIndicator('data_vencimento') }}</span>
                          </button>
                        </th>
                        <th class="px-4 py-4 font-medium">
                          <button
                            type="button"
                            class="inline-flex items-center gap-2 transition hover:text-white"
                            @click="toggleSort('data_pagamento')"
                          >
                            <span>Pagamento</span>
                            <span class="text-xs text-slate-500">{{ getSortIndicator('data_pagamento') }}</span>
                          </button>
                        </th>
                        <th class="px-4 py-4 font-medium text-right">
                          <button
                            type="button"
                            class="inline-flex items-center gap-2 transition hover:text-white"
                            @click="toggleSort('valor_pago')"
                          >
                            <span>Valor pago</span>
                            <span class="text-xs text-slate-500">{{ getSortIndicator('valor_pago') }}</span>
                          </button>
                        </th>
                    <th class="px-4 py-4 font-medium">
                      Destino
                    </th>
                  </tr>
                </thead>

                <tbody class="divide-y divide-white/10 text-slate-100">
                  <tr
                    v-for="(titulo, index) in titulosPaginados"
                    :key="titulo.id"
                    class="align-top transition hover:bg-white/[0.03]"
                  >
                    <td class="px-4 py-4 font-medium text-white break-words">
                      {{ normalizeText(titulo.fornecedor) }}
                    </td>
                    <td class="px-4 py-4 text-slate-300 break-words">
                      {{ normalizeText(titulo.historico) }}
                    </td>
                    <td class="px-4 py-4 text-slate-300 break-words">
                      <div class="space-y-2">
                        <p>{{ normalizeText(titulo.observacao) }}</p>
                        <p
                          v-if="titulo.complemento"
                          class="text-xs text-slate-400"
                        >
                          {{ titulo.complemento }}
                        </p>
                      </div>
                    </td>
                    <td class="px-4 py-4 text-slate-300">
                      {{ getParcela(titulo) }}
                    </td>
                    <td class="px-4 py-4 text-slate-300">
                      {{ formatDateBR(titulo.data_vencimento) }}
                    </td>
                    <td class="px-4 py-4 text-slate-300">
                      {{ formatDateBR(getDataPagamento(titulo)) }}
                    </td>
                    <td class="px-4 py-4 text-right font-semibold text-emerald-300">
                      {{ formatCurrencyBRL(titulo.valor_pago) }}
                    </td>
                    <td class="px-4 py-4">
                      <div
                        class="relative w-full"
                        @click.stop
                      >
                        <button
                          type="button"
                          class="flex w-full items-start justify-between gap-2 rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-left text-sm text-white outline-none transition hover:bg-slate-950 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20"
                          @click="alternarCategoriaAberta(titulo.id)"
                        >
                          <span class="block min-w-0 flex-1 break-words whitespace-normal leading-5">
                            {{ getCategoriaLabel(titulo.categoriaCodigo) }}
                          </span>
                          <span class="shrink-0 pt-0.5 text-slate-400">
                            {{ categoriaAbertaId === titulo.id ? '▲' : '▼' }}
                          </span>
                        </button>

                        <div
                          v-if="categoriaAbertaId === titulo.id"
                          class="absolute right-0 z-30 w-[320px] max-w-[min(90vw,360px)] overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 shadow-2xl shadow-black/30 backdrop-blur"
                          :class="shouldOpenCategoriaAcima(index, titulosPaginados.length) ? 'bottom-[calc(100%+0.5rem)]' : 'top-[calc(100%+0.5rem)]'"
                        >
                          <div class="max-h-80 overflow-y-auto p-2">
                            <button
                              type="button"
                              class="flex w-full rounded-xl px-3 py-2.5 text-left text-sm text-slate-200 transition hover:bg-white/[0.06]"
                              @click="selecionarCategoria(titulo, null)"
                            >
                              Selecione
                            </button>
                            <button
                              v-for="categoria in RATEIO_CATEGORIAS"
                              :key="categoria.codigo"
                              type="button"
                              class="flex w-full rounded-xl px-3 py-2.5 text-left text-sm leading-5 text-slate-200 transition hover:bg-white/[0.06]"
                              :class="titulo.categoriaCodigo === categoria.codigo ? 'bg-emerald-400/10 text-emerald-200' : ''"
                              @click="selecionarCategoria(titulo, categoria.codigo)"
                            >
                              {{ categoria.label }}
                            </button>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="border-t border-white/10 bg-slate-900/90 px-4 py-3">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div class="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.16em] text-slate-500">
                  <span>Pagina {{ paginaAtual }} de {{ totalPaginas }}</span>
                  <span>100 titulos por pagina</span>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    class="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="paginaAtual === 1 || salvando"
                    @click="irParaPagina(paginaAtual - 1)"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    class="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="paginaAtual === totalPaginas || salvando || !paginaAtualCompleta"
                    @click="irParaPagina(paginaAtual + 1)"
                  >
                    Proxima
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 shadow-2xl shadow-black/20 backdrop-blur">
        <div class="flex flex-col gap-6">
          <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div class="space-y-2">
              <p class="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-300">
                Relatorio final
              </p>
              <h2 class="text-2xl font-semibold text-white">
                Consolidado por categoria
              </h2>
              <p class="max-w-2xl text-sm text-slate-300">
                O resumo abaixo mostra a distribuicao das despesas e serve de base para a exportacao do PDF.
              </p>
            </div>

            <button
              type="button"
              class="inline-flex items-center justify-center rounded-2xl border border-emerald-400/30 bg-emerald-400/15 px-5 py-3 text-sm font-semibold text-emerald-100 transition hover:border-emerald-300 hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="!gruposRelatorio.length"
              @click="exportarPdf"
            >
              Baixar PDF
            </button>
          </div>

          <div
            v-if="!gruposRelatorio.length"
            class="rounded-2xl border border-white/10 bg-slate-900/60 px-5 py-12 text-center text-sm text-slate-300"
          >
            Classifique os titulos para visualizar o relatorio consolidado.
          </div>

          <div
            v-else
            class="grid gap-6"
          >
            <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <article
                v-for="grupo in gruposRelatorio"
                :key="grupo.codigo"
                class="rounded-3xl border border-white/10 bg-white/[0.03] p-5"
              >
                <p class="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">
                  {{ grupo.label }}
                </p>
                <p class="mt-4 text-3xl font-semibold text-white">
                  {{ formatCurrencyBRL(grupo.total) }}
                </p>
                <p class="mt-2 text-sm text-slate-400">
                  {{ grupo.itens.length }} titulo(s) classificados
                </p>
              </article>
            </div>

            <div class="grid gap-5">
              <article
                v-for="grupo in gruposRelatorio"
                :key="`${grupo.codigo}-detalhes`"
                class="overflow-hidden rounded-3xl border border-white/10 bg-slate-900/75"
              >
                <div class="flex flex-col gap-3 border-b border-white/10 px-5 py-5 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p class="text-lg font-semibold text-white">
                      {{ grupo.label }}
                    </p>
                    <p class="text-sm text-slate-400">
                      {{ grupo.itens.length }} titulo(s) | {{ formatCurrencyBRL(grupo.total) }}
                    </p>
                  </div>
                </div>

                <div class="overflow-x-auto">
                  <table class="min-w-full text-left text-sm">
                    <thead class="bg-slate-800/80 text-slate-300">
                      <tr>
                        <th class="px-4 py-3 font-medium">
                          Fornecedor
                        </th>
                        <th class="px-4 py-3 font-medium">
                          Historico
                        </th>
                        <th class="px-4 py-3 font-medium">
                          Parcela
                        </th>
                        <th class="px-4 py-3 font-medium">
                          Vencimento
                        </th>
                        <th class="px-4 py-3 font-medium">
                          Pagamento
                        </th>
                        <th class="px-4 py-3 font-medium text-right">
                          Valor pago
                        </th>
                      </tr>
                    </thead>

                    <tbody class="divide-y divide-white/10">
                      <tr
                        v-for="titulo in grupo.itens"
                        :key="`${grupo.codigo}-${titulo.id}`"
                      >
                        <td class="px-4 py-3 text-white">
                          {{ normalizeText(titulo.fornecedor) }}
                        </td>
                        <td class="px-4 py-3 text-slate-300">
                          {{ normalizeText(titulo.historico) }}
                        </td>
                        <td class="px-4 py-3 text-slate-300">
                          {{ getParcela(titulo) }}
                        </td>
                        <td class="px-4 py-3 text-slate-300">
                          {{ formatDateBR(titulo.data_vencimento) }}
                        </td>
                        <td class="px-4 py-3 text-slate-300">
                          {{ formatDateBR(getDataPagamento(titulo)) }}
                        </td>
                        <td class="px-4 py-3 text-right font-semibold text-emerald-300">
                          {{ formatCurrencyBRL(titulo.valor_pago) }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </article>
            </div>
          </div>
        </div>
      </section>
    </div>

    <Transition
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-200 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="importando"
        class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/78 px-6 backdrop-blur-md"
      >
        <div class="w-full max-w-xl overflow-hidden rounded-[32px] border border-white/10 bg-slate-950/95 shadow-[0_30px_120px_rgba(0,0,0,0.45)]">
          <div class="relative overflow-hidden p-8 sm:p-10">
            <div class="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.18),_transparent_35%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.12),_transparent_38%)]" />
            <div class="relative space-y-8">
              <div class="flex items-center gap-4">
                <div class="relative flex h-16 w-16 items-center justify-center">
                  <span class="absolute h-16 w-16 animate-ping rounded-full bg-emerald-400/15" />
                  <span class="absolute h-12 w-12 rounded-full border border-emerald-300/30" />
                  <span class="h-8 w-8 animate-spin rounded-full border-2 border-emerald-300/30 border-t-emerald-300" />
                </div>

                <div class="space-y-2">
                  <p class="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-300">
                    Importacao em andamento
                  </p>
                  <h2 class="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                    {{ etapaImportacao }}
                  </h2>
                </div>
              </div>

              <div class="space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <p class="text-base leading-7 text-slate-200">
                  {{ detalheImportacao }}
                </p>
                <p class="text-sm text-slate-400">
                  Isso costuma levar so alguns instantes. Enquanto finalizamos, pode pegar uma agua ou um cafe.
                </p>
              </div>

              <div class="grid gap-3 sm:grid-cols-3">
                <div class="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3">
                  <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Competencia
                  </p>
                  <p class="mt-2 text-lg font-semibold text-white">
                    {{ competenciaFormatada }}
                  </p>
                </div>
                <div class="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3">
                  <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Etapa atual
                  </p>
                  <p class="mt-2 text-lg font-semibold text-white">
                    {{ importando ? 'Sincronizando' : 'Concluido' }}
                  </p>
                </div>
                <div class="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3">
                  <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Status
                  </p>
                  <p class="mt-2 text-lg font-semibold text-emerald-300">
                    Aguarde...
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <Transition
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-200 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="modalConfirmacaoImportacaoAberto"
        class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/82 px-6 backdrop-blur-sm"
        @click.self="modalConfirmacaoImportacaoAberto = false"
      >
        <div class="w-full max-w-lg rounded-[28px] border border-amber-400/20 bg-slate-950/95 p-8 shadow-[0_30px_120px_rgba(0,0,0,0.45)]">
          <div class="space-y-6">
            <div class="space-y-3">
              <p class="text-xs font-semibold uppercase tracking-[0.28em] text-amber-300">
                Confirmar nova importacao
              </p>
              <h2 class="text-2xl font-semibold text-white">
                Isso vai substituir o trabalho atual.
              </h2>
              <p class="text-sm leading-7 text-slate-300">
                Importar uma nova competencia limpa a base atual no inicio do fluxo. Se voce continuar, as classificacoes em andamento e os titulos carregados serao removidos para dar lugar aos dados do novo periodo.
              </p>
            </div>

            <div class="grid gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:grid-cols-3">
              <div>
                <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Competencia atual
                </p>
                <p class="mt-2 text-lg font-semibold text-white">
                  {{ competenciaFormatada }}
                </p>
              </div>
              <div>
                <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Classificados
                </p>
                <p class="mt-2 text-lg font-semibold text-emerald-300">
                  {{ totalClassificados }}
                </p>
              </div>
              <div>
                <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Pendentes
                </p>
                <p class="mt-2 text-lg font-semibold text-amber-300">
                  {{ totalPendentes }}
                </p>
              </div>
            </div>

            <div class="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                class="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.08]"
                @click="modalConfirmacaoImportacaoAberto = false"
              >
                Continuar classificando
              </button>
              <button
                type="button"
                class="inline-flex items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-400/15 px-5 py-3 text-sm font-semibold text-amber-100 transition hover:border-amber-300 hover:bg-amber-400/20"
                @click="confirmarNovaImportacao"
              >
                Importar nova competencia
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </main>
</template>
