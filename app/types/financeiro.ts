import type { RateioCategoriaCodigo } from '../constants/rateioCategorias'

export interface TituloPagoRow {
  id: number
  titulo_id: number | null
  baixa_id: number | null
  filial: string | null
  fornecedor: string | null
  historico: string | null
  observacao: string | null
  complemento: string | null
  sufixo: string | null
  numero_titulo: string | null
  valor_pago: number | null
  data_vencimento: string | null
  data_baixa: string | null
  data_ultimo_pagamento: string | null
}

export interface TituloClassificacaoRow {
  titulo_pago_id: number
  categoria_codigo: RateioCategoriaCodigo
  competencia: string
}

export interface TituloListItem extends TituloPagoRow {
  categoriaCodigo: RateioCategoriaCodigo | null
  categoriaOrigem: 'salva' | 'sugerida' | null
  sugestaoConfianca: number | null
  revisaoStatus: 'sugestao' | 'pendente' | 'salva'
}

export interface RateioHistoricoRow {
  titulo_origem_id: number
  titulo_erp_id: number | null
  baixa_erp_id: number | null
  competencia: string
  filial: string | null
  fornecedor: string | null
  historico: string | null
  observacao: string | null
  complemento: string | null
  categoria_codigo: RateioCategoriaCodigo
}

export interface ImportacaoTitulosWebhookResponse {
  success?: boolean
  competencia?: string
  total_importado?: number | string
  message?: string
}

export interface ImportacaoTitulosApiResponse {
  ok: boolean
  competencia: string
  totalImportado: number
  message: string
}
