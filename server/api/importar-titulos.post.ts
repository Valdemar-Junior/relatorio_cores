import type { ImportacaoTitulosWebhookResponse } from '../../app/types/financeiro'

function isCompetenciaValida(value: string) {
  return /^(0[1-9]|1[0-2])\/\d{4}$/.test(value)
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const body = await readBody<{ competencia?: string }>(event)
  const competencia = body.competencia?.trim()

  if (!competencia || !isCompetenciaValida(competencia)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Competencia invalida. Use o formato MM/AAAA.'
    })
  }

  try {
    const response = await $fetch<ImportacaoTitulosWebhookResponse>(config.n8nWebhookUrl, {
      method: 'POST',
      query: {
        competencia
      },
      body: {
        competencia
      }
    })

    const totalImportado = Number(response?.total_importado ?? 0)
    const message = response?.message?.trim() || 'Importacao concluida com sucesso.'

    return {
      ok: response?.success !== false,
      competencia,
      totalImportado: Number.isFinite(totalImportado) ? totalImportado : 0,
      message
    }
  }
  catch (error) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Falha ao disparar o webhook do n8n.',
      data: error
    })
  }
})
