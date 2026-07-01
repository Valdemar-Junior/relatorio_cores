alter table public.titulos_financeiros_pagos
add column if not exists filial text;

alter table public.rateio_historico_classificacoes
add column if not exists filial text;

-- Preenche a filial na memoria quando o titulo de origem ainda estiver
-- disponivel. Registros antigos continuam validos mesmo com filial nula.
update public.rateio_historico_classificacoes as memoria
set filial = titulo.filial
from public.titulos_financeiros_pagos as titulo
where memoria.titulo_origem_id = titulo.id
  and memoria.filial is null
  and titulo.filial is not null;
