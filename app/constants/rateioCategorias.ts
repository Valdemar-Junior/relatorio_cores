export const RATEIO_CATEGORIAS = [
  { codigo: 'sem_rateio', label: 'Sem rateio' },
  { codigo: 'despesa_loja_assu', label: 'Despesa Loja Assu' },
  { codigo: 'despesa_loja_mossoro', label: 'Despesa Loja Mossoro' },
  { codigo: 'despesa_rateada_geral', label: 'Despesa Rateada Geral' },
  { codigo: 'investimento_loja_assu', label: 'Investimento Loja Assu' },
  { codigo: 'investimento_loja_mossoro_centro', label: 'Investimento Loja Mossoro Centro' },
  { codigo: 'despesa_comercial_me', label: 'Despesa Comercial Me' },
  { codigo: 'despesa_marilia', label: 'Despesa Marilia' },
  { codigo: 'despesa_extra_loja_assu', label: 'Despesa Extra Loja Assu' },
  { codigo: 'despesa_extra_loja_mossoro', label: 'Despesa Extra Loja Mossoro' },
  { codigo: 'despesa_loja_mossoro_partage', label: 'Despesa Loja Mossoro Partage' },
  { codigo: 'investimento_loja_mossoro_partage', label: 'Investimento Loja Mossoro Partage' },
  { codigo: 'despesa_rateada_entre_lojas_mossoro', label: 'Despesa Rateada entre Lojas Mossoro' },
  { codigo: 'despesa_loja_avelloz_assu', label: 'Despesa Loja Avelloz Assu' }
] as const

export type RateioCategoriaCodigo = (typeof RATEIO_CATEGORIAS)[number]['codigo']

export const RATEIO_CATEGORIAS_MAP = Object.fromEntries(
  RATEIO_CATEGORIAS.map((categoria) => [categoria.codigo, categoria.label])
) as Record<RateioCategoriaCodigo, string>
