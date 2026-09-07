<script setup lang="ts">
withDefaults(defineProps<{
  animated?: boolean
}>(), {
  animated: true,
})
</script>

<template>
  <span
    class="auth-brand-mark"
    :class="{ 'auth-brand-mark--animated': animated }"
    data-cy="auth-brand-mark"
    aria-hidden="true"
  >
    <img
      src="/brand/bipflow-logo-auth.webp"
      alt=""
      class="auth-brand-mark__image"
      draggable="false"
    />

    <span class="auth-brand-mark__speed-lines">
      <span class="auth-brand-mark__speed-line auth-brand-mark__speed-line--one" />
      <span class="auth-brand-mark__speed-line auth-brand-mark__speed-line--two" />
      <span class="auth-brand-mark__speed-line auth-brand-mark__speed-line--three" />
    </span>
  </span>
</template>

<style scoped>
.auth-brand-mark {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  isolation: isolate;
}

.auth-brand-mark__image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
}

.auth-brand-mark__speed-lines {
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: hidden;
  border-radius: 0.75rem;
  pointer-events: none;
}

.auth-brand-mark__speed-line {
  position: absolute;
  left: 7%;
  height: 7.25%;
  border-radius: 9999px;
  background: linear-gradient(90deg, rgba(255, 120, 159, 0), #ff789f 42%, #ff008c 100%);
  box-shadow: 0 0 0.4rem rgba(255, 0, 140, 0.35);
  opacity: 0;
  transform: translate3d(-18%, 0, 0) scaleX(0.74);
  transform-origin: right center;
  will-change: transform, opacity;
}

.auth-brand-mark__speed-line--one {
  top: 43.5%;
  left: 12%;
  width: 17%;
}

.auth-brand-mark__speed-line--two {
  top: 52.25%;
  width: 23%;
}

.auth-brand-mark__speed-line--three {
  top: 61.5%;
  left: 12.5%;
  width: 17%;
}

.auth-brand-mark--animated .auth-brand-mark__speed-line {
  animation: auth-brand-line-flow 4.6s cubic-bezier(0.22, 1, 0.36, 1) infinite;
}

.auth-brand-mark--animated .auth-brand-mark__speed-line--two {
  animation-delay: 0.18s;
}

.auth-brand-mark--animated .auth-brand-mark__speed-line--three {
  animation-delay: 0.36s;
}

@keyframes auth-brand-line-flow {
  0%,
  18%,
  100% {
    opacity: 0;
    transform: translate3d(-18%, 0, 0) scaleX(0.74);
  }

  34% {
    opacity: 0.52;
  }

  50% {
    opacity: 0.92;
    transform: translate3d(8%, 0, 0) scaleX(1.02);
  }

  68% {
    opacity: 0;
    transform: translate3d(18%, 0, 0) scaleX(0.88);
  }
}

@media (prefers-reduced-motion: reduce) {
  .auth-brand-mark__speed-line {
    animation: none !important;
    opacity: 0;
    transform: none;
  }
}
</style>
