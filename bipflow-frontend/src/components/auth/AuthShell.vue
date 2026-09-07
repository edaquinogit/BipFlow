<script setup lang="ts">
import AuthBrandMark from '@/components/auth/AuthBrandMark.vue'

defineProps<{
  eyebrow: string
  title: string
  description: string
}>()

const year = new Date().getFullYear()
</script>

<template>
  <main class="grid min-h-screen min-h-dvh bg-bip-soft lg:grid-cols-[minmax(0,1.08fr)_minmax(30rem,0.92fr)]">
    <section
      class="auth-brand-panel relative hidden min-h-screen min-h-dvh flex-col justify-between overflow-hidden px-12 py-10 lg:flex xl:px-16 xl:py-12"
      aria-label="Apresentação do BipFlow Manage"
    >
      <div class="auth-brand-grid" aria-hidden="true" />
      <div class="auth-brand-orbit auth-brand-orbit--large" aria-hidden="true" />
      <div class="auth-brand-orbit auth-brand-orbit--small" aria-hidden="true" />
      <div class="auth-brand-glow" aria-hidden="true" />

      <svg
        class="auth-brand-wave"
        viewBox="0 0 900 300"
        fill="none"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M-20 206C125 118 228 292 382 205C526 123 622 73 920 202" />
        <path d="M-20 238C140 150 248 322 412 228C568 138 706 130 920 232" />
        <path d="M-20 270C158 184 276 338 450 253C636 162 762 196 920 264" />
      </svg>

      <div class="relative z-10 flex items-center gap-3.5">
        <span class="auth-logo-frame auth-logo-frame--dark">
          <AuthBrandMark />
        </span>
        <span class="auth-wordmark auth-wordmark--dark">BipFlow Manage</span>
      </div>

      <div class="relative z-10 max-w-xl pb-8">
        <p class="text-[11px] font-extrabold uppercase tracking-[0.28em] text-[#ff4ca8]">
          {{ eyebrow }}
        </p>
        <h1 class="auth-hero-title mt-5 max-w-[12ch] text-[clamp(2.75rem,4.4vw,5rem)] text-white">
          {{ title }}
        </h1>
        <p class="premium-copy mt-6 max-w-lg text-base leading-7 text-zinc-300 xl:text-lg xl:leading-8">
          {{ description }}
        </p>

        <ul v-if="$slots.highlights" class="mt-10 grid gap-3.5 xl:mt-12">
          <slot name="highlights" />
        </ul>
      </div>

      <div class="relative z-10 flex items-center justify-between gap-4 border-t border-white/10 pt-5 text-xs text-zinc-500">
        <p>&copy; {{ year }} BipFlow</p>
        <p>Ambiente protegido e monitorado</p>
      </div>
    </section>

    <section class="auth-form-panel flex min-h-screen min-h-dvh items-start justify-center px-6 sm:px-8 lg:items-center lg:px-10 xl:px-16">
      <div class="w-full max-w-[28rem]">
        <div class="mb-8 flex items-center gap-3 lg:hidden">
          <span class="auth-logo-frame auth-logo-frame--light">
            <AuthBrandMark />
          </span>
          <span class="auth-wordmark auth-wordmark--light">BipFlow Manage</span>
        </div>

        <slot />

        <div v-if="$slots.footer" class="mt-8 border-t border-bip-line pt-5 text-center">
          <slot name="footer" />
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.auth-brand-panel {
  background:
    radial-gradient(circle at 14% 86%, rgba(255, 0, 140, 0.12), transparent 30rem),
    radial-gradient(circle at 88% 8%, rgba(255, 120, 159, 0.08), transparent 24rem),
    linear-gradient(145deg, #05050a 0%, #090911 56%, #11111a 100%);
}

.auth-form-panel {
  padding-top: max(2rem, env(safe-area-inset-top));
  padding-bottom: max(2rem, env(safe-area-inset-bottom));
  background:
    radial-gradient(circle at 96% 0%, rgba(255, 0, 140, 0.035), transparent 22rem),
    #fafafa;
}

@media (min-width: 640px) {
  .auth-form-panel {
    padding-top: max(3rem, env(safe-area-inset-top));
    padding-bottom: max(3rem, env(safe-area-inset-bottom));
  }
}

.auth-brand-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
  background-size: 72px 72px;
  mask-image: linear-gradient(to bottom right, black 0%, transparent 76%);
}

.auth-brand-glow {
  position: absolute;
  right: -16rem;
  bottom: -15rem;
  width: 38rem;
  height: 38rem;
  border-radius: 9999px;
  background: radial-gradient(circle, rgba(255, 0, 140, 0.12), transparent 66%);
  animation: auth-glow-float 12s ease-in-out infinite alternate;
}

.auth-brand-orbit {
  position: absolute;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 9999px;
  transform: rotate(-18deg);
}

.auth-brand-orbit::after {
  position: absolute;
  top: 10%;
  left: 18%;
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 9999px;
  background: linear-gradient(135deg, #ff789f, #ff008c);
  box-shadow: 0 0 1.25rem rgba(255, 0, 140, 0.65);
  content: '';
}

.auth-brand-orbit--large {
  top: 14%;
  right: -11rem;
  width: 33rem;
  height: 33rem;
}

.auth-brand-orbit--small {
  top: 26%;
  right: -3rem;
  width: 18rem;
  height: 18rem;
  opacity: 0.75;
}

.auth-brand-wave {
  position: absolute;
  right: -8%;
  bottom: 8%;
  width: 112%;
  height: 33%;
  opacity: 0.22;
}

.auth-brand-wave path {
  stroke: rgba(255, 255, 255, 0.28);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
  animation: auth-wave-drift 14s ease-in-out infinite alternate;
}

.auth-brand-wave path:nth-child(2) {
  opacity: 0.62;
  animation-delay: -4s;
}

.auth-brand-wave path:nth-child(3) {
  opacity: 0.32;
  animation-delay: -8s;
}

.auth-logo-frame {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 3rem;
  height: 3rem;
  padding: 0.25rem;
  border-radius: 1rem;
}

.auth-logo-frame--dark {
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18px 45px -20px rgba(255, 0, 140, 0.7);
}

.auth-logo-frame--light {
  border: 1px solid #e5e7eb;
  background: white;
  box-shadow: 0 12px 34px -24px rgba(5, 5, 10, 0.75);
}

.auth-wordmark {
  font-family: var(--font-sans);
  font-size: 1.2rem;
  font-weight: 800;
  letter-spacing: -0.045em;
  line-height: 1;
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
}

.auth-wordmark--dark {
  background-image: linear-gradient(100deg, #ffffff 0%, #f4f4f5 48%, #a1a1aa 100%);
}

.auth-wordmark--light {
  background-image: linear-gradient(100deg, #05050a 0%, #111827 60%, #4b5563 100%);
}

.auth-hero-title {
  font-family: var(--font-sans);
  font-weight: 800;
  letter-spacing: -0.065em;
  line-height: 0.98;
  text-wrap: balance;
}

@keyframes auth-glow-float {
  from {
    transform: translate3d(-4%, 3%, 0) scale(1);
  }

  to {
    transform: translate3d(4%, -5%, 0) scale(1.08);
  }
}

@keyframes auth-wave-drift {
  from {
    transform: translateX(-1.5%);
  }

  to {
    transform: translateX(1.5%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .auth-brand-glow,
  .auth-brand-wave path {
    animation: none;
  }
}
</style>
