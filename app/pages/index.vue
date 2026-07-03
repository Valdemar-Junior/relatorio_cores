<script setup lang="ts">
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

import { RATEIO_CATEGORIAS, RATEIO_CATEGORIAS_MAP, type RateioCategoriaCodigo } from '../constants/rateioCategorias'
import type { ImportacaoTitulosApiResponse, RateioHistoricoRow, TituloClassificacaoRow, TituloListItem, TituloPagoRow } from '../types/financeiro'
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

const LOCAL_STORAGE_COMPETENCIA_KEY = 'rateio_despesas_competencia'
const LOCAL_STORAGE_ULTIMA_IMPORTACAO_KEY = 'rateio_despesas_ultima_importacao'
const TITULOS_BATCH_SIZE = 1000
const TITULOS_POR_PAGINA = 100

const supabase = useSupabaseClient()

const competenciaInput = ref(getCurrentCompetenciaInput())
const busca = ref('')
const filtroClassificacao = ref<'todos' | 'sugestoes' | 'pendentes' | 'salvos'>('todos')
const historicosSelecionados = ref<string[]>([])
const titulos = ref<TituloListItem[]>([])
const historicoClassificacoes = ref<RateioHistoricoRow[]>([])
const carregando = ref(false)
const importando = ref(false)
const salvando = ref(false)
const erro = ref('')
const sucesso = ref('')
const migrationAviso = ref('')
const ultimaImportacao = ref<string | null>(null)
const filtroHistoricosAberto = ref(false)
const buscaHistorico = ref('')
const categoriaAbertaId = ref<number | null>(null)
const etapaImportacao = ref('Preparando a importacao...')
const detalheImportacao = ref('Estamos organizando a base para carregar os titulos da competencia selecionada.')
const paginaAtual = ref(1)
const modalConfirmacaoImportacaoAberto = ref(false)
const telaInicializada = ref(false)
const aplicacaoEmLotePendente = ref<{
  tituloOrigemId: number
  categoriaCodigo: RateioCategoriaCodigo
  titulosIds: number[]
} | null>(null)
const detalheEmEdicao = ref<{
  tituloId: number
  campo: 'observacao' | 'complemento'
  valor: string
} | null>(null)
const detalheSalvando = ref(false)

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

const titulosFiltradosBase = computed(() => {
  const termo = sanitizeSearch(busca.value)

  const base = historicosSelecionados.value.length
    ? titulos.value.filter((titulo) => historicosSelecionados.value.includes(normalizeText(titulo.historico)))
    : titulos.value

  const filtrados = !termo
    ? base
    : base.filter((titulo) => {
      const categoria = titulo.categoriaCodigo ? RATEIO_CATEGORIAS_MAP[titulo.categoriaCodigo] : ''
      const textoBase = [
        titulo.filial,
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

const titulosFiltrados = computed(() => {
  if (filtroClassificacao.value === 'sugestoes') {
    return titulosFiltradosBase.value.filter((titulo) => titulo.revisaoStatus === 'sugestao')
  }

  if (filtroClassificacao.value === 'pendentes') {
    return titulosFiltradosBase.value.filter((titulo) => titulo.revisaoStatus === 'pendente')
  }

  if (filtroClassificacao.value === 'salvos') {
    return titulosFiltradosBase.value.filter((titulo) => titulo.revisaoStatus === 'salva')
  }

  return titulosFiltradosBase.value
})

const totalTitulos = computed(() => titulos.value.length)
const totalClassificados = computed(() => titulos.value.filter((titulo) => !!titulo.categoriaCodigo).length)
const totalSugeridos = computed(() => titulos.value.filter((titulo) => titulo.revisaoStatus === 'sugestao').length)
const totalPendentes = computed(() => totalTitulos.value - totalClassificados.value)
const titulosResumo = computed(() => historicosSelecionados.value.length
  ? titulos.value.filter((titulo) => historicosSelecionados.value.includes(normalizeText(titulo.historico)))
  : titulos.value
)
const totalTitulosResumo = computed(() => titulosResumo.value.length)
const totalClassificadosResumo = computed(() => titulosResumo.value.filter((titulo) => !!titulo.categoriaCodigo).length)
const totalSugeridosResumo = computed(() => titulosResumo.value.filter((titulo) => titulo.revisaoStatus === 'sugestao').length)
const totalPendentesResumo = computed(() => titulosResumo.value.filter((titulo) => titulo.revisaoStatus === 'pendente').length)
const totalSalvosResumo = computed(() => titulosResumo.value.filter((titulo) => titulo.revisaoStatus === 'salva').length)
const valorTotalPagoResumo = computed(() => titulosResumo.value.reduce((total, titulo) => total + Number(titulo.valor_pago ?? 0), 0))
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
const pendentesPaginaAtual = computed(() => titulosPaginados.value.filter((titulo) => !titulo.categoriaCodigo).length)
const categoriasOrdenadasPorUso = computed(() => {
  const frequencias = new Map<RateioCategoriaCodigo, number>()

  for (const registro of historicoClassificacoes.value) {
    frequencias.set(registro.categoria_codigo, (frequencias.get(registro.categoria_codigo) ?? 0) + 1)
  }

  return RATEIO_CATEGORIAS
    .map((categoria, indiceOriginal) => ({
      ...categoria,
      frequencia: frequencias.get(categoria.codigo) ?? 0,
      indiceOriginal
    }))
    .sort((a, b) => b.frequencia - a.frequencia || a.indiceOriginal - b.indiceOriginal)
})

const gruposRelatorio = computed(() =>
  RATEIO_CATEGORIAS.map((categoria) => {
    const itens = titulosFiltradosBase.value.filter((titulo) => titulo.categoriaCodigo === categoria.codigo)
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
  return normalizeText(a.fornecedor).localeCompare(normalizeText(b.fornecedor), 'pt-BR')
    || normalizeText(a.historico).localeCompare(normalizeText(b.historico), 'pt-BR')
    || compareDates(a.data_vencimento, b.data_vencimento)
    || a.id - b.id
}

function compareDates(a: string | null | undefined, b: string | null | undefined) {
  const aTime = a ? new Date(a).getTime() : 0
  const bTime = b ? new Date(b).getTime() : 0

  return aTime - bTime
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

function isDetalheEmEdicao(tituloId: number, campo: 'observacao' | 'complemento') {
  return detalheEmEdicao.value?.tituloId === tituloId && detalheEmEdicao.value.campo === campo
}

async function iniciarEdicaoDetalhe(titulo: TituloListItem, campo: 'observacao' | 'complemento') {
  if (detalheSalvando.value) {
    return
  }

  detalheEmEdicao.value = {
    tituloId: titulo.id,
    campo,
    valor: titulo[campo] ?? ''
  }

  await nextTick()
  document.getElementById(`edicao-${campo}-${titulo.id}`)?.focus()
}

function cancelarEdicaoDetalhe() {
  if (!detalheSalvando.value) {
    detalheEmEdicao.value = null
  }
}

async function salvarEdicaoDetalhe(titulo: TituloListItem) {
  const edicao = detalheEmEdicao.value

  if (!edicao || edicao.tituloId !== titulo.id || detalheSalvando.value) {
    return
  }

  const novoValor = edicao.valor.trim() || null

  if (novoValor === titulo[edicao.campo]) {
    detalheEmEdicao.value = null
    return
  }

  detalheSalvando.value = true
  erro.value = ''

  try {
    const { error } = await supabase
      .from('titulos_financeiros_pagos')
      .update({ [edicao.campo]: novoValor })
      .eq('id', titulo.id)
      .select('id')
      .single()

    if (error) {
      throw error
    }

    titulo[edicao.campo] = novoValor
    detalheEmEdicao.value = null
  }
  catch (caughtError) {
    erro.value = getErrorMessage(caughtError, `Nao foi possivel salvar a ${edicao.campo}.`)
  }
  finally {
    detalheSalvando.value = false
  }
}

function alternarCategoriaAberta(tituloId: number) {
  categoriaAbertaId.value = categoriaAbertaId.value === tituloId ? null : tituloId
}

function getChaveDestinoSemelhante(titulo: Pick<TituloPagoRow, 'filial' | 'fornecedor' | 'historico'>) {
  const partes = [titulo.filial, titulo.fornecedor, titulo.historico]
    .map((valor) => getTextoComparavel(valor))

  return partes.every(Boolean) ? partes.join('|') : null
}

function definirCategoria(titulo: TituloListItem, categoriaCodigo: RateioCategoriaCodigo | null) {
  titulo.categoriaCodigo = categoriaCodigo
  titulo.categoriaOrigem = titulo.revisaoStatus === 'sugestao' && categoriaCodigo ? 'sugerida' : null
  titulo.sugestaoConfianca = null
}

function selecionarCategoria(titulo: TituloListItem, categoriaCodigo: RateioCategoriaCodigo | null) {
  definirCategoria(titulo, categoriaCodigo)
  categoriaAbertaId.value = null
  aplicacaoEmLotePendente.value = null

  if (!categoriaCodigo) {
    return
  }

  const chaveOrigem = getChaveDestinoSemelhante(titulo)
  const semelhantesPendentes = titulos.value.filter((item) => (
    chaveOrigem !== null
    && item.id !== titulo.id
    && !item.categoriaCodigo
    && getChaveDestinoSemelhante(item) === chaveOrigem
  ))

  if (semelhantesPendentes.length) {
    aplicacaoEmLotePendente.value = {
      tituloOrigemId: titulo.id,
      categoriaCodigo,
      titulosIds: semelhantesPendentes.map((item) => item.id)
    }
  }
}

function aplicarCategoriaAosSemelhantes() {
  const aplicacao = aplicacaoEmLotePendente.value

  if (!aplicacao) {
    return
  }

  const ids = new Set(aplicacao.titulosIds)

  for (const titulo of titulos.value) {
    if (ids.has(titulo.id) && !titulo.categoriaCodigo) {
      definirCategoria(titulo, aplicacao.categoriaCodigo)
    }
  }

  aplicacaoEmLotePendente.value = null
}

function dispensarAplicacaoEmLote() {
  aplicacaoEmLotePendente.value = null
}

function getTextoComparavel(value: string | null | undefined) {
  return sanitizeSearch(value ?? '')
}

function getChavesHistorico(item: Pick<TituloPagoRow, 'fornecedor' | 'historico' | 'observacao' | 'complemento'>) {
  const fornecedor = getTextoComparavel(item.fornecedor)
  const historico = getTextoComparavel(item.historico)
  const observacao = getTextoComparavel(item.observacao)
  const complemento = getTextoComparavel(item.complemento)

  return {
    completa: [fornecedor, historico, observacao, complemento].join('|'),
    fornecedorHistorico: [fornecedor, historico].join('|'),
    fornecedor,
    historico
  }
}

function isHistoricoGenerico(historico: string) {
  return historico === 'pagamento fornecedor'
    || historico === 'pagamento de fornecedor'
}

function getMelhorCategoria(registros: RateioHistoricoRow[], minimoOcorrencias: number, minimoConfianca: number) {
  if (registros.length < minimoOcorrencias) {
    return null
  }

  const contagem = new Map<RateioCategoriaCodigo, number>()

  for (const registro of registros) {
    contagem.set(registro.categoria_codigo, (contagem.get(registro.categoria_codigo) ?? 0) + 1)
  }

  const [categoria, ocorrencias] = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
  const confianca = ocorrencias ? ocorrencias / registros.length : 0

  if (!categoria || confianca < minimoConfianca) {
    return null
  }

  return { categoria, confianca }
}

function sugerirCategoria(titulo: TituloPagoRow, historicoRateio: RateioHistoricoRow[]) {
  const chavesTitulo = getChavesHistorico(titulo)
  const chavesRegistros = historicoRateio.map((registro) => ({
    registro,
    chaves: getChavesHistorico(registro)
  }))

  const correspondenciaCompleta = chavesRegistros
    .filter(({ chaves }) => chaves.completa === chavesTitulo.completa)
    .map(({ registro }) => registro)
  const sugestaoCompleta = getMelhorCategoria(correspondenciaCompleta, 1, 0.8)

  if (sugestaoCompleta) {
    return sugestaoCompleta
  }

  const correspondenciaFornecedorHistorico = chavesRegistros
    .filter(({ chaves }) => chaves.fornecedorHistorico === chavesTitulo.fornecedorHistorico)
    .map(({ registro }) => registro)
  const sugestaoFornecedorHistorico = getMelhorCategoria(correspondenciaFornecedorHistorico, 2, 0.8)

  if (sugestaoFornecedorHistorico) {
    return sugestaoFornecedorHistorico
  }

  if (chavesTitulo.historico && !isHistoricoGenerico(chavesTitulo.historico)) {
    const correspondenciaHistorico = chavesRegistros
      .filter(({ chaves }) => chaves.historico === chavesTitulo.historico)
      .map(({ registro }) => registro)
    const sugestaoHistorico = getMelhorCategoria(correspondenciaHistorico, 2, 0.9)

    if (sugestaoHistorico) {
      return sugestaoHistorico
    }
  }

  const correspondenciaFornecedor = chavesRegistros
    .filter(({ chaves }) => chaves.fornecedor === chavesTitulo.fornecedor)
    .map(({ registro }) => registro)

  return getMelhorCategoria(correspondenciaFornecedor, 3, 0.9)
}

function shouldOpenCategoriaAcima(index: number, totalItens: number) {
  return index >= Math.max(totalItens - 3, 0)
}

async function irParaPagina(page: number) {
  const paginaDestino = Math.min(Math.max(1, page), totalPaginas.value)

  if (paginaDestino !== paginaAtual.value) {
    paginaAtual.value = paginaDestino
    erro.value = ''
  }
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
      .select('id, titulo_id, baixa_id, filial, fornecedor, historico, observacao, complemento, sufixo, numero_titulo, valor_pago, data_vencimento, data_baixa, data_ultimo_pagamento')
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

async function carregarTodoHistorico() {
  const todoHistorico: RateioHistoricoRow[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('rateio_historico_classificacoes')
      .select('titulo_origem_id, titulo_erp_id, baixa_erp_id, competencia, filial, fornecedor, historico, observacao, complemento, categoria_codigo')
      .range(from, from + TITULOS_BATCH_SIZE - 1)

    if (error) {
      throw error
    }

    const lote = (data as RateioHistoricoRow[] | null) ?? []
    todoHistorico.push(...lote)

    if (lote.length < TITULOS_BATCH_SIZE) {
      break
    }

    from += TITULOS_BATCH_SIZE
  }

  return todoHistorico
}

function ajustarPaginacao() {
  if (paginaAtual.value > totalPaginas.value) {
    paginaAtual.value = totalPaginas.value
  }

  if (paginaAtual.value < 1) {
    paginaAtual.value = 1
  }
}

async function carregarTitulos(exibirLoading = true, selecionarTodosOsHistoricos = false) {
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

    let historicoRateio: RateioHistoricoRow[] = []

    try {
      historicoRateio = await carregarTodoHistorico()
      historicoClassificacoes.value = historicoRateio
    }
    catch (historicoError) {
      historicoClassificacoes.value = []
      const message = getErrorMessage(historicoError, '')

      if (isMissingTableError(message)) {
        migrationAviso.value = 'A memoria de classificacoes ainda nao existe. Rode a migration de 30/06/2026 no Supabase para ativar as sugestoes automaticas.'
      }
      else {
        throw historicoError
      }
    }

    titulos.value = ((data as TituloPagoRow[] | null) ?? []).map((titulo) => {
      const categoriaSalva = classificacaoMap.get(titulo.id)
      const sugestao = categoriaSalva ? null : sugerirCategoria(titulo, historicoRateio)

      return {
        ...titulo,
        categoriaCodigo: categoriaSalva ?? sugestao?.categoria ?? null,
        categoriaOrigem: categoriaSalva ? 'salva' : sugestao ? 'sugerida' : null,
        sugestaoConfianca: sugestao?.confianca ?? null,
        revisaoStatus: categoriaSalva ? 'salva' : sugestao ? 'sugestao' : 'pendente'
      }
    })

    if (selecionarTodosOsHistoricos) {
      historicosSelecionados.value = [...new Set(
        titulos.value
          .map((titulo) => normalizeText(titulo.historico))
          .filter((historico) => historico !== '-')
      )]
    }

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

    await carregarTitulos(false, true)

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

async function salvarClassificacoes(titulosAlvo: TituloListItem[], mensagem: string) {
  if (!titulosAlvo.length) {
    erro.value = 'Nao ha titulos carregados para salvar.'
    return false
  }

  if (migrationAviso.value) {
    erro.value = 'Rode a migration da tabela de classificacoes no Supabase antes de salvar.'
    return false
  }

  salvando.value = true
  resetMensagens()

  try {
    const classificacoes = titulosAlvo
      .filter((titulo): titulo is TituloListItem & { categoriaCodigo: RateioCategoriaCodigo } => !!titulo.categoriaCodigo)
      .map((titulo) => ({
        titulo_pago_id: titulo.id,
        competencia: competenciaFormatada.value,
        categoria_codigo: titulo.categoriaCodigo
      }))

    const idsSemCategoria = titulosAlvo.filter((titulo) => !titulo.categoriaCodigo).map((titulo) => titulo.id)

    const memoriaClassificacoes = titulosAlvo
      .filter((titulo): titulo is TituloListItem & { categoriaCodigo: RateioCategoriaCodigo, baixa_id: number } => (
        !!titulo.categoriaCodigo && titulo.baixa_id !== null
      ))
      .map((titulo) => ({
        titulo_origem_id: titulo.id,
        titulo_erp_id: titulo.titulo_id,
        baixa_erp_id: titulo.baixa_id,
        competencia: competenciaFormatada.value,
        filial: titulo.filial,
        fornecedor: titulo.fornecedor,
        historico: titulo.historico,
        observacao: titulo.observacao,
        complemento: titulo.complemento,
        categoria_codigo: titulo.categoriaCodigo
      }))

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

    if (memoriaClassificacoes.length > 0) {
      const { error } = await supabase
        .from('rateio_historico_classificacoes')
        .upsert(memoriaClassificacoes, { onConflict: 'competencia,baixa_erp_id' })

      if (error) {
        throw error
      }
    }

    if (idsSemCategoria.length > 0) {
      const baixasSemCategoria = titulosAlvo
        .filter((titulo): titulo is TituloListItem & { baixa_id: number } => !titulo.categoriaCodigo && titulo.baixa_id !== null)
        .map((titulo) => titulo.baixa_id)

      if (baixasSemCategoria.length === 0) {
        await carregarTitulos(false)
        sucesso.value = mensagem
        return true
      }

      const { error } = await supabase
        .from('rateio_historico_classificacoes')
        .delete()
        .eq('competencia', competenciaFormatada.value)
        .in('baixa_erp_id', baixasSemCategoria)

      if (error) {
        throw error
      }
    }

    await carregarTitulos(false)
    sucesso.value = mensagem
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

async function salvarPaginaAtual() {
  const itensDaPagina = [...titulosPaginados.value]
  const itensPreenchidos = itensDaPagina.filter((titulo) => !!titulo.categoriaCodigo)

  if (filtroClassificacao.value === 'pendentes' && !itensPreenchidos.length) {
    erro.value = 'Preencha ao menos um destino desta pagina antes de salvar.'
    return
  }

  const mensagem = filtroClassificacao.value === 'sugestoes'
    ? `${itensPreenchidos.length} sugestao(oes) confirmada(s). O progresso ficou salvo.`
    : `${itensPreenchidos.length} classificacao(oes) salva(s). Voce pode continuar depois.`

  const salvou = await salvarClassificacoes(
    filtroClassificacao.value === 'pendentes' ? itensPreenchidos : itensDaPagina,
    mensagem
  )

  if (salvou && import.meta.client) {
    await nextTick()
    document.getElementById('tabela-classificacao')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    })
  }
}

function exportarPdf() {
  if (!gruposRelatorio.value.length) {
    erro.value = 'Classifique ao menos um titulo antes de gerar o PDF.'
    return
  }

  resetMensagens()

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a4'
  })

  const marginX = 40
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const generatedAt = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date())

  doc.setFillColor(7, 11, 34)
  doc.rect(0, 0, pageWidth, 96, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(23)
  doc.text('Relatorio de Rateio de Despesas', marginX, 42)
  doc.setFontSize(11)
  doc.text(`Competencia: ${competenciaFormatada.value}`, marginX, 65)
  doc.text(`Gerado em: ${generatedAt}`, marginX, 82)

  autoTable(doc, {
    startY: 116,
    margin: { top: 40, right: marginX, bottom: 44, left: marginX },
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

  let currentY = ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 150) + 26

  for (const grupo of gruposRelatorio.value) {
    if (currentY > pageHeight - 105) {
      doc.addPage()
      currentY = 42
    }

    doc.setTextColor(15, 23, 42)
    doc.setFontSize(15)
    doc.text(grupo.label, marginX, currentY)

    autoTable(doc, {
      startY: currentY + 14,
      margin: { top: 40, right: marginX, bottom: 44, left: marginX },
      theme: 'striped',
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      head: [['Filial', 'Fornecedor', 'Historico / detalhes', 'Parcela', 'Vencimento', 'Pagamento', 'Valor pago']],
      body: grupo.itens.map((titulo) => [
        normalizeText(titulo.filial),
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
        0: { cellWidth: 90 },
        1: { cellWidth: 135 },
        2: { cellWidth: 250 },
        3: { cellWidth: 50 },
        4: { cellWidth: 70 },
        5: { cellWidth: 70 },
        6: { cellWidth: 97, halign: 'right' }
      }
    })

    currentY = ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? currentY) + 28
  }

  const totalPages = doc.getNumberOfPages()

  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page)
    doc.setDrawColor(226, 232, 240)
    doc.line(marginX, pageHeight - 31, pageWidth - marginX, pageHeight - 31)
    doc.setFontSize(8.5)
    doc.setTextColor(100, 116, 139)
    doc.text(`Competencia ${competenciaFormatada.value}`, marginX, pageHeight - 16)
    doc.text(`Pagina ${page} de ${totalPages}`, pageWidth - marginX, pageHeight - 16, { align: 'right' })
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

  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message?: string }).message || fallback)
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

function tratarAtalhoAplicacaoEmLote(event: KeyboardEvent) {
  if (!aplicacaoEmLotePendente.value || detalheEmEdicao.value || event.repeat || event.isComposing) {
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    aplicarCategoriaAosSemelhantes()
  }
  else if (event.key === 'Escape') {
    event.preventDefault()
    dispensarAplicacaoEmLote()
  }
}

onMounted(async () => {
  document.addEventListener('click', fecharMenus)
  document.addEventListener('keydown', tratarAtalhoAplicacaoEmLote)
  const competenciaSalva = import.meta.client ? localStorage.getItem(LOCAL_STORAGE_COMPETENCIA_KEY) : null
  const ultimaImportacaoSalva = import.meta.client ? localStorage.getItem(LOCAL_STORAGE_ULTIMA_IMPORTACAO_KEY) : null

  if (competenciaSalva) {
    competenciaInput.value = competenciaSalva
  }

  if (ultimaImportacaoSalva) {
    ultimaImportacao.value = ultimaImportacaoSalva
  }

  await carregarTitulos(true, true)
  telaInicializada.value = true
})

onBeforeUnmount(() => {
  document.removeEventListener('click', fecharMenus)
  document.removeEventListener('keydown', tratarAtalhoAplicacaoEmLote)
})

watch(competenciaInput, async (value, oldValue) => {
  if (!import.meta.client) {
    return
  }

  localStorage.setItem(LOCAL_STORAGE_COMPETENCIA_KEY, value)

  if (!telaInicializada.value || value === oldValue || importando.value) {
    return
  }

  await carregarTitulos(true, true)
})

watch([busca, historicosSelecionados, filtroClassificacao], () => {
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

    <div class="relative mx-auto flex w-full max-w-[1920px] flex-col gap-8 px-3 py-10 sm:px-5 lg:px-6">
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

      <div
        v-if="aplicacaoEmLotePendente"
        class="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-emerald-400/30 bg-slate-950/95 p-3 shadow-2xl shadow-black/50 backdrop-blur"
        role="status"
      >
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p class="text-sm text-slate-100">
            Aplicar este destino também a
            <strong class="text-emerald-300">
              {{ aplicacaoEmLotePendente.titulosIds.length }}
              {{ aplicacaoEmLotePendente.titulosIds.length === 1 ? 'pendente igual' : 'pendentes iguais' }}
            </strong>?
          </p>
          <div class="flex shrink-0 gap-2">
            <button
              type="button"
              class="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/[0.06]"
              @click="dispensarAplicacaoEmLote"
            >
              Não <span class="ml-1 text-slate-500">Esc</span>
            </button>
            <button
              type="button"
              class="rounded-xl border border-emerald-400/30 bg-emerald-400/15 px-4 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-400/25"
              @click="aplicarCategoriaAosSemelhantes"
            >
              Aplicar <span class="ml-1 text-emerald-300/70">Enter</span>
            </button>
          </div>
        </div>
      </div>

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

      <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <AppStatCard
          :label="historicosSelecionados.length ? 'Titulos no filtro' : 'Titulos carregados'"
          :value="String(totalTitulosResumo)"
          tone="emerald"
        />
        <AppStatCard
          label="Classificados"
          :value="String(totalClassificadosResumo)"
          tone="sky"
        />
        <AppStatCard
          label="Pendentes"
          :value="String(totalPendentesResumo)"
          tone="amber"
        />
        <AppStatCard
          label="Sugeridos pelo historico"
          :value="String(totalSugeridosResumo)"
          tone="sky"
        />
        <AppStatCard
          label="Valor total pago"
          :value="formatCurrencyBRL(valorTotalPagoResumo)"
          tone="rose"
        />
      </section>

      <section
        id="tabela-classificacao"
        class="scroll-mt-4 rounded-[28px] border border-white/10 bg-slate-950/70 p-6 shadow-2xl shadow-black/20 backdrop-blur"
      >
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

            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/60 p-1.5 sm:w-fit">
            <button
              type="button"
              class="rounded-xl px-4 py-2 text-sm font-semibold transition"
              :class="filtroClassificacao === 'todos'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'"
              @click="filtroClassificacao = 'todos'"
            >
              Todos <span class="ml-1 text-xs opacity-70">{{ totalTitulosResumo }}</span>
            </button>
            <button
              type="button"
              class="rounded-xl px-4 py-2 text-sm font-semibold transition"
              :class="filtroClassificacao === 'sugestoes'
                ? 'bg-sky-400/15 text-sky-200 shadow-sm'
                : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'"
              @click="filtroClassificacao = 'sugestoes'"
            >
              Sugestoes <span class="ml-1 text-xs opacity-70">{{ totalSugeridosResumo }}</span>
            </button>
            <button
              type="button"
              class="rounded-xl px-4 py-2 text-sm font-semibold transition"
              :class="filtroClassificacao === 'pendentes'
                ? 'bg-amber-400/15 text-amber-200 shadow-sm'
                : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'"
              @click="filtroClassificacao = 'pendentes'"
            >
              Pendentes <span class="ml-1 text-xs opacity-70">{{ totalPendentesResumo }}</span>
            </button>
            <button
              type="button"
              class="rounded-xl px-4 py-2 text-sm font-semibold transition"
              :class="filtroClassificacao === 'salvos'
                ? 'bg-emerald-400/15 text-emerald-200 shadow-sm'
                : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'"
              @click="filtroClassificacao = 'salvos'"
            >
              Salvos/Revisados <span class="ml-1 text-xs opacity-70">{{ totalSalvosResumo }}</span>
            </button>
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
            <div
              v-if="totalSugeridos"
              class="border-b border-sky-400/20 bg-sky-400/10 px-4 py-3 text-sm text-sky-100"
            >
              Restam {{ totalSugeridos }} sugestao(oes) para revisar. Confirme uma pagina por vez; o progresso fica salvo para continuar depois.
            </div>
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
              <span
                v-if="pendentesPaginaAtual"
                class="ml-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 font-semibold text-amber-200"
              >
                {{ pendentesPaginaAtual }} pendente(s) nesta pagina
              </span>
            </div>
            <div class="overflow-x-auto xl:overflow-visible">
              <table class="w-full table-fixed text-left text-sm">
                <colgroup>
                  <col class="w-[10%]">
                  <col class="w-[13%]">
                  <col class="w-[11%]">
                  <col class="w-[16%]">
                  <col class="w-[6%]">
                  <col class="w-[8%]">
                  <col class="w-[8%]">
                  <col class="w-[9%]">
                  <col class="w-[19%]">
                </colgroup>
                <thead class="bg-slate-800/90 text-slate-300">
                  <tr>
                        <th class="px-4 py-4 font-medium">
                          Filial
                        </th>
                        <th class="px-4 py-4 font-medium">
                          Fornecedor (A-Z)
                        </th>
                        <th class="px-4 py-4 font-medium">
                          Historico
                        </th>
                        <th class="px-4 py-4 font-medium">
                          Observacao / Complemento
                        </th>
                        <th class="px-4 py-4 font-medium">
                          Parcela
                        </th>
                        <th class="px-4 py-4 font-medium">
                          Vencimento
                        </th>
                        <th class="px-4 py-4 font-medium">
                          Pagamento
                        </th>
                        <th class="px-4 py-4 font-medium text-right">
                          Valor pago
                        </th>
                    <th class="px-4 py-4 font-medium">
                      Destino
                    </th>
                  </tr>
                </thead>

                <tbody class="divide-y divide-white/10 text-slate-100">
                  <tr
                    v-for="(titulo, index) in titulosPaginados"
                    :id="`titulo-${titulo.id}`"
                    :key="titulo.id"
                    class="align-top transition"
                    :class="titulo.categoriaCodigo
                      ? 'hover:bg-white/[0.03]'
                      : 'bg-amber-400/[0.08] shadow-[inset_4px_0_0_rgba(251,191,36,0.85)] hover:bg-amber-400/[0.12]'"
                  >
                    <td class="px-4 py-4 text-slate-300 break-words">
                      {{ normalizeText(titulo.filial) }}
                    </td>
                    <td class="px-4 py-4 font-medium text-white break-words">
                      {{ normalizeText(titulo.fornecedor) }}
                    </td>
                    <td class="px-4 py-4 text-slate-300 break-words">
                      {{ normalizeText(titulo.historico) }}
                    </td>
                    <td class="px-4 py-4 text-slate-300 break-words">
                      <div class="space-y-3">
                        <div>
                          <div
                            v-if="isDetalheEmEdicao(titulo.id, 'observacao') && detalheEmEdicao"
                            class="space-y-2"
                          >
                            <textarea
                              :id="`edicao-observacao-${titulo.id}`"
                              v-model="detalheEmEdicao.valor"
                              rows="3"
                              class="w-full resize-y rounded-xl border border-emerald-400/40 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-emerald-400/20"
                              placeholder="Digite a observação"
                              :disabled="detalheSalvando"
                              @keydown.enter.exact.prevent="salvarEdicaoDetalhe(titulo)"
                              @keydown.esc.prevent="cancelarEdicaoDetalhe"
                            />
                            <div class="flex items-center gap-2 text-[11px]">
                              <button
                                type="button"
                                class="font-semibold text-emerald-300 hover:text-emerald-200 disabled:opacity-50"
                                :disabled="detalheSalvando"
                                @click="salvarEdicaoDetalhe(titulo)"
                              >
                                {{ detalheSalvando ? 'Salvando...' : 'Salvar · Enter' }}
                              </button>
                              <button
                                type="button"
                                class="text-slate-500 hover:text-slate-300 disabled:opacity-50"
                                :disabled="detalheSalvando"
                                @click="cancelarEdicaoDetalhe"
                              >
                                Cancelar · Esc
                              </button>
                            </div>
                          </div>
                          <p
                            v-else-if="titulo.observacao"
                            class="cursor-text rounded-lg transition hover:bg-white/[0.04]"
                            title="Duplo clique para editar a observação"
                            @dblclick="iniciarEdicaoDetalhe(titulo, 'observacao')"
                          >
                            {{ titulo.observacao }}
                          </p>
                          <button
                            v-else
                            type="button"
                            class="text-left text-xs font-medium text-slate-500 transition hover:text-emerald-300"
                            @click="iniciarEdicaoDetalhe(titulo, 'observacao')"
                          >
                            + Adicionar observação
                          </button>
                        </div>

                        <div>
                          <div
                            v-if="isDetalheEmEdicao(titulo.id, 'complemento') && detalheEmEdicao"
                            class="space-y-2"
                          >
                            <textarea
                              :id="`edicao-complemento-${titulo.id}`"
                              v-model="detalheEmEdicao.valor"
                              rows="3"
                              class="w-full resize-y rounded-xl border border-emerald-400/40 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-emerald-400/20"
                              placeholder="Digite o complemento"
                              :disabled="detalheSalvando"
                              @keydown.enter.exact.prevent="salvarEdicaoDetalhe(titulo)"
                              @keydown.esc.prevent="cancelarEdicaoDetalhe"
                            />
                            <div class="flex items-center gap-2 text-[11px]">
                              <button
                                type="button"
                                class="font-semibold text-emerald-300 hover:text-emerald-200 disabled:opacity-50"
                                :disabled="detalheSalvando"
                                @click="salvarEdicaoDetalhe(titulo)"
                              >
                                {{ detalheSalvando ? 'Salvando...' : 'Salvar · Enter' }}
                              </button>
                              <button
                                type="button"
                                class="text-slate-500 hover:text-slate-300 disabled:opacity-50"
                                :disabled="detalheSalvando"
                                @click="cancelarEdicaoDetalhe"
                              >
                                Cancelar · Esc
                              </button>
                            </div>
                          </div>
                          <p
                            v-else-if="titulo.complemento"
                            class="cursor-text rounded-lg text-xs text-slate-400 transition hover:bg-white/[0.04]"
                            title="Duplo clique para editar o complemento"
                            @dblclick="iniciarEdicaoDetalhe(titulo, 'complemento')"
                          >
                            {{ titulo.complemento }}
                          </p>
                          <button
                            v-else
                            type="button"
                            class="text-left text-xs font-medium text-slate-500 transition hover:text-emerald-300"
                            @click="iniciarEdicaoDetalhe(titulo, 'complemento')"
                          >
                            + Adicionar complemento
                          </button>
                        </div>
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
                          v-if="!titulo.categoriaCodigo"
                          class="mt-2"
                        >
                          <span class="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-xs font-semibold text-amber-200">
                            Destino pendente
                          </span>
                        </div>

                        <div
                          v-if="titulo.categoriaOrigem === 'sugerida'"
                          class="mt-2 flex items-center gap-2 text-xs text-sky-300"
                        >
                          <span class="rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-1 font-medium">
                            Sugestao do historico
                          </span>
                          <span v-if="titulo.sugestaoConfianca">
                            {{ Math.round(titulo.sugestaoConfianca * 100) }}%
                          </span>
                        </div>

                        <div
                          v-if="titulo.revisaoStatus === 'salva'"
                          class="mt-2"
                        >
                          <span class="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-xs font-medium text-emerald-200">
                            Salvo / revisado
                          </span>
                        </div>

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
                              v-for="categoria in categoriasOrdenadasPorUso"
                              :key="categoria.codigo"
                              type="button"
                              class="flex w-full rounded-xl px-3 py-2.5 text-left text-sm leading-5 text-slate-200 transition hover:bg-white/[0.06]"
                              :class="titulo.categoriaCodigo === categoria.codigo ? 'bg-emerald-400/10 text-emerald-200' : ''"
                              @click="selecionarCategoria(titulo, categoria.codigo)"
                            >
                              <span class="flex w-full items-center justify-between gap-3">
                                <span>{{ categoria.label }}</span>
                                <span
                                  v-if="categoria.frequencia"
                                  class="shrink-0 text-xs text-slate-500"
                                >
                                  {{ categoria.frequencia }}x
                                </span>
                              </span>
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
                    :disabled="paginaAtual === totalPaginas || salvando"
                    @click="irParaPagina(paginaAtual + 1)"
                  >
                    Proxima
                  </button>
                  <button
                    type="button"
                    class="inline-flex items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-400/15 px-4 py-2 text-xs font-semibold text-emerald-100 transition hover:border-emerald-300 hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="salvando || !titulosPaginados.length"
                    @click="salvarPaginaAtual"
                  >
                    {{ salvando ? 'Salvando...' : 'Salvar esta pagina' }}
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
            Classifique os titulos para visualizar o relatorio consolidado e gerar o PDF final.
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
