alter table public.rateio_historico_classificacoes
add column if not exists titulo_erp_id bigint;

alter table public.rateio_historico_classificacoes
add column if not exists baixa_erp_id bigint;

-- O ID local pode ser reutilizado depois que a tabela mensal e limpa.
-- Ele continua apenas como referencia, sem controlar mais a unicidade.
alter table public.rateio_historico_classificacoes
drop constraint if exists rateio_historico_competencia_titulo_key;

-- So relaciona registros cuja competencia corresponde a data da baixa.
-- Isso evita associar IDs locais reutilizados depois de uma reimportacao.
update public.rateio_historico_classificacoes as memoria
set
  titulo_erp_id = titulo.titulo_id,
  baixa_erp_id = titulo.baixa_id
from public.titulos_financeiros_pagos as titulo
where memoria.titulo_origem_id = titulo.id
  and memoria.competencia = to_char(
    titulo.data_baixa at time zone 'America/Fortaleza',
    'MM/YYYY'
  )
  and (memoria.titulo_erp_id is null or memoria.baixa_erp_id is null);

alter table public.rateio_historico_classificacoes
drop constraint if exists rateio_historico_competencia_baixa_erp_key;

alter table public.rateio_historico_classificacoes
add constraint rateio_historico_competencia_baixa_erp_key
unique (competencia, baixa_erp_id);

create index if not exists idx_rateio_historico_titulo_erp
  on public.rateio_historico_classificacoes (titulo_erp_id);
