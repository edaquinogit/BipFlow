<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useToast } from '@/composables/useToast';
import { Logger } from '@/services/logger';

/**
 * --- 1. INFRAESTRUTURA ---
 */
const router = useRouter();
const toast = useToast();

// Função centralizada para teletransporte do usuário (Clean Navigation)
const navigateToDashboard = () => router.push({ name: 'dashboard-overview' });

/**
 * --- 2. LOG DE ENGENHARIA ---
 * Em produção, aqui você poderia disparar um log para o Sentry ou DataDog
 */
const reportIssue = () => {
  Logger.info('Server error issue reported by user');
  toast.info('Relato enviado. Nossa equipe ja foi notificada.');
};
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-200 font-sans flex items-center justify-center p-6 selection:bg-red-500/30">
    
    <div class="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div class="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-red-900/10 blur-[120px] rounded-full"></div>
      
      <div class="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-zinc-800 to-transparent opacity-50"></div>
    </div>

    <main class="relative z-10 max-w-2xl w-full text-center space-y-12">
      
      <section class="space-y-4">
        <div class="inline-flex items-center gap-3 px-4 py-2 rounded-full border border-red-500/20 bg-red-500/5 mb-4">
          <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
          <span class="text-[10px] font-black uppercase tracking-[0.3em] text-red-500">System Critical Error</span>
        </div>
        
        <h1 class="text-7xl md:text-9xl font-black text-white tracking-tighter italic uppercase leading-none">
          500<span class="text-red-600">.</span>
        </h1>
        
        <h2 class="text-2xl font-bold text-zinc-300 tracking-tight">
          Bip Flow Hub Connection Failure
        </h2>
        
        <p class="text-zinc-500 text-sm max-w-md mx-auto leading-relaxed">
          The internal engine encountered an unexpected synchronization gap. 
          The core services are currently being recalibrated by our automated systems.
        </p>
      </section>

      <section class="bg-zinc-900/50 border border-white/5 rounded-2xl p-6 font-mono text-left relative overflow-hidden group">
        <div class="flex gap-1.5 mb-4">
          <div class="w-2 h-2 rounded-full bg-zinc-800"></div>
          <div class="w-2 h-2 rounded-full bg-zinc-800"></div>
          <div class="w-2 h-2 rounded-full bg-zinc-800"></div>
        </div>
        <p class="text-[10px] text-zinc-600 leading-relaxed">
          <span class="text-red-800">ERROR_CODE:</span> 0xINTERNAL_HUB_TIMEOUT<br>
          <span class="text-zinc-700">TRACE_ID:</span> {{ Math.random().toString(36).substring(7).toUpperCase() }}<br>
          <span class="text-zinc-700">LOCATION:</span> BipFlow-Core
        </p>
      </section>

      <footer class="flex flex-col sm:flex-row items-center justify-center gap-4">
        <button 
          @click="navigateToDashboard"
          class="w-full sm:w-auto bg-white text-black px-10 py-4 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-zinc-200 transition-all active:scale-95"
        >
          Return to Hub
        </button>
        
        <button 
          @click="reportIssue"
          class="w-full sm:w-auto bg-zinc-900 border border-white/10 text-zinc-400 px-10 py-4 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-zinc-800 hover:text-white transition-all"
        >
          Report to NYC Tech
        </button>
      </footer>

    </main>
  </div>
</template>
