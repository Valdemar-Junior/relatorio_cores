-- Guarda o valor de cada baixa na memoria mensal para permitir comparar
-- competencias (titulos_financeiros_pagos e limpa a cada importacao).
alter table public.rateio_historico_classificacoes
add column if not exists valor_pago numeric(14, 2);

alter table public.rateio_historico_classificacoes
add column if not exists data_baixa timestamp with time zone;

alter table public.rateio_historico_classificacoes
add column if not exists numero_titulo text;

-- Preenche o que ainda estiver disponivel na tabela do mes importado.
update public.rateio_historico_classificacoes as memoria
set
  valor_pago = titulo.valor_pago,
  data_baixa = titulo.data_baixa,
  numero_titulo = titulo.numero_titulo
from public.titulos_financeiros_pagos as titulo
where memoria.baixa_erp_id = titulo.baixa_id
  and memoria.competencia = to_char(
    titulo.data_baixa at time zone 'America/Fortaleza',
    'MM/YYYY'
  )
  and memoria.valor_pago is null;

create index if not exists idx_rateio_historico_competencia_fornecedor
  on public.rateio_historico_classificacoes (competencia, fornecedor);
