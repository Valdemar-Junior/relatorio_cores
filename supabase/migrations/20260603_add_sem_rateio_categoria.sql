alter table public.titulo_pago_classificacoes
drop constraint if exists titulo_pago_classificacoes_categoria_codigo_check;

alter table public.titulo_pago_classificacoes
add constraint titulo_pago_classificacoes_categoria_codigo_check
check (
  categoria_codigo in (
    'sem_rateio',
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
);
