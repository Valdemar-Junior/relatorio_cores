export function getCurrentCompetenciaInput() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')

  return `${now.getFullYear()}-${month}`
}

export function competenciaFromInput(value: string) {
  const [year, month] = value.split('-')

  if (!year || !month) {
    return ''
  }

  return `${month}/${year}`
}

export function getCompetenciaRange(value: string) {
  const [yearString, monthString] = value.split('-')
  const year = Number(yearString)
  const monthIndex = Number(monthString) - 1

  if (Number.isNaN(year) || Number.isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    throw new Error('Competencia invalida. Use o formato MM/AAAA.')
  }

  const start = new Date(Date.UTC(year, monthIndex, 1))
  const end = new Date(Date.UTC(year, monthIndex + 1, 1))

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString()
  }
}

export function formatCurrencyBRL(value: number | null | undefined) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value ?? 0)
}

export function formatDateBR(value: string | null | undefined) {
  if (!value) {
    return '-'
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date(value))
}

export function normalizeText(value: string | null | undefined) {
  if (!value) {
    return '-'
  }

  return value.trim()
}
