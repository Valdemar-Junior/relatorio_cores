import type { RateioCategoriaCodigo } from '../constants/rateioCategorias'

export interface TituloPagoRow {
  id: number
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
}
