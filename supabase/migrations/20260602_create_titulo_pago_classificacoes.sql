create table if not exists public.titulo_pago_classificacoes (
  titulo_pago_id bigint not null,
  competencia text not null,
  categoria_codigo text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint titulo_pago_classificacoes_pkey primary key (titulo_pago_id),
  constraint titulo_pago_classificacoes_titulo_pago_id_fkey
    foreign key (titulo_pago_id)
    references public.titulos_financeiros_pagos (id)
    on delete cascade,
  constraint titulo_pago_classificacoes_competencia_check
    check (competencia ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'),
  constraint titulo_pago_classificacoes_categoria_codigo_check
    check (
      categoria_codigo in (
        'despesa_loja_assu',
        'despesa_loja_mossoro',
        'despesa_rateada_geral',
        'investimento_loja_assu',
        'investimento_loja_mossoro_centro',
        'despesa_comercial_me',
        'despesa_marilia',
        'despesa_extra_loja_assu',
        'despesa_extra_loja_mossoro',
        'despesa_loja_mossoro_partage',
        'investimento_loja_mossoro_partage',
        'despesa_rateada_entre_lojas_mossoro',
        'despesa_loja_avelloz_assu'
      )
    )
);

create index if not exists idx_titulo_pago_classificacoes_competencia
  on public.titulo_pago_classificacoes (competencia);

create index if not exists idx_titulo_pago_classificacoes_categoria
  on public.titulo_pago_classificacoes (categoria_codigo);

create or replace function public.set_titulo_pago_classificacoes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_titulo_pago_classificacoes_updated_at on public.titulo_pago_classificacoes;

create trigger trg_titulo_pago_classificacoes_updated_at
before update on public.titulo_pago_classificacoes
for each row
execute function public.set_titulo_pago_classificacoes_updated_at();
