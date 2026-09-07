<script setup lang="ts">
/**
 * Official BipFlow mark for the authentication screens.
 *
 * The logo asset itself never moves or deforms -- three decorative glow
 * layers sit exactly over the three pink bars of the mark and drift with a
 * slow, low-contrast light. Only `transform` and `opacity` animate, so
 * there is never a layout shift, and `prefers-reduced-motion` removes the
 * motion entirely. Purely decorative: `aria-hidden`, `pointer-events: none`.
 *
 * Bar coordinates are percentages of the 256x256 asset:
 *   bar 1  top 43.5%  left 12%    width 17%
 *   bar 2  top 52.25% left 7%     width 23%
 *   bar 3  top 61.5%  left 12.5%  width 17%
 */
</script>

<template>
  <span class="auth-brand-mark" data-cy="auth-brand-mark" aria-hidden="true">
    <img
      src="/brand/bipflow-logo-auth.webp"
      alt=""
      class="auth-brand-mark__logo"
      aria-hidden="true"
      draggable="false"
    />
    <span class="auth-brand-mark__bar auth-brand-mark__bar--1" aria-hidden="true" />
    <span class="auth-brand-mark__bar auth-brand-mark__bar--2" aria-hidden="true" />
    <span class="auth-brand-mark__bar auth-brand-mark__bar--3" aria-hidden="true" />
  </span>
</template>

<style scoped>
.auth-brand-mark {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 1 / 1;
  isolation: isolate;
}

.auth-brand-mark__logo {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
}

.auth-brand-mark__bar {
  position: absolute;
  height: 6%;
  border-radius: 999px;
  pointer-events: none;
  transform: translate3d(-8%, 0, 0);
  background: linear-gradient(
    90deg,
    rgba(255, 45, 142, 0) 0%,
    rgba(255, 45, 142, 0.9) 45%,
    rgba(255, 138, 190, 0.95) 62%,
    rgba(255, 45, 142, 0) 100%
  );
  filter: blur(1.5px);
  mix-blend-mode: screen;
  opacity: 0.35;
  will-change: transform, opacity;
  animation: auth-brand-bar-drift 4.6s cubic-bezier(0.22, 1, 0.36, 1) infinite;
}

.auth-brand-mark__bar--1 {
  top: 43.5%;
  left: 12%;
  width: 17%;
  animation-delay: 0ms;
}

.auth-brand-mark__bar--2 {
  top: 52.25%;
  left: 7%;
  width: 23%;
  animation-delay: 180ms;
}

.auth-brand-mark__bar--3 {
  top: 61.5%;
  left: 12.5%;
  width: 17%;
  animation-delay: 360ms;
}

@keyframes auth-brand-bar-drift {
  0%,
  100% {
    opacity: 0.32;
    transform: translate3d(-8%, 0, 0);
  }

  50% {
    opacity: 0.9;
    transform: translate3d(8%, 0, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .auth-brand-mark__bar {
    animation: none;
    opacity: 0.5;
    transform: none;
  }
}
</style>
