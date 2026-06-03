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
    const response = await $fetch(config.n8nWebhookUrl, {
      method: 'POST',
      query: {
        competencia
      },
      body: {
        competencia
      }
    })

    return {
      ok: true,
      competencia,
      response
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
