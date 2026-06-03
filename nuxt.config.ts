// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxtjs/supabase', '@nuxtjs/tailwindcss'],
  runtimeConfig: {
    n8nWebhookUrl:
      process.env.N8N_WEBHOOK_TITULOS_PAGOS_URL ||
      'https://n8n.lojaodosmoveis.shop/webhook/pegar_titulos_pagos'
  },
  supabase: {
    redirect: false
  }
})
