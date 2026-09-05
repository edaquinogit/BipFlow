import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';
import { useCarouselAutoplay } from '../useCarouselAutoplay';

function mockReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe('useCarouselAutoplay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not autoplay with zero or one slide', () => {
    const scope = effectScope();
    scope.run(() => {
      const slideCount = ref(1);
      const { isAutoplaying, activeIndex } = useCarouselAutoplay({ slideCount, intervalMs: 1000 });

      expect(isAutoplaying.value).toBe(false);
      vi.advanceTimersByTime(5000);
      expect(activeIndex.value).toBe(0);
    });
    scope.stop();
  });

  it('advances the active index on each interval with 2+ slides', () => {
    const scope = effectScope();
    scope.run(() => {
      const slideCount = ref(3);
      const { isAutoplaying, activeIndex } = useCarouselAutoplay({ slideCount, intervalMs: 1000 });

      expect(isAutoplaying.value).toBe(true);
      vi.advanceTimersByTime(1000);
      expect(activeIndex.value).toBe(1);
      vi.advanceTimersByTime(1000);
      expect(activeIndex.value).toBe(2);
      // Loops back to the first slide instead of overflowing.
      vi.advanceTimersByTime(1000);
      expect(activeIndex.value).toBe(0);
    });
    scope.stop();
  });

  it('never starts a timer when prefers-reduced-motion is set', () => {
    mockReducedMotion(true);
    const scope = effectScope();
    scope.run(() => {
      const slideCount = ref(3);
      const { isAutoplaying, activeIndex } = useCarouselAutoplay({ slideCount, intervalMs: 1000 });

      expect(isAutoplaying.value).toBe(false);
      vi.advanceTimersByTime(10000);
      expect(activeIndex.value).toBe(0);
    });
    scope.stop();
  });

  it('pauses and resumes without creating a second timer', () => {
    const scope = effectScope();
    scope.run(() => {
      const slideCount = ref(3);
      const { activeIndex, pause, resume } = useCarouselAutoplay({ slideCount, intervalMs: 1000 });

      pause();
      vi.advanceTimersByTime(5000);
      expect(activeIndex.value).toBe(0);

      resume();
      vi.advanceTimersByTime(1000);
      expect(activeIndex.value).toBe(1);

      // Pausing/resuming repeatedly must not stack intervals -- one tick
      // still advances by exactly one slide, never more.
      pause();
      resume();
      pause();
      resume();
      vi.advanceTimersByTime(1000);
      expect(activeIndex.value).toBe(2);
    });
    scope.stop();
  });

  it('clears the timer when the owning scope is disposed', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const scope = effectScope();
    scope.run(() => {
      const slideCount = ref(3);
      useCarouselAutoplay({ slideCount, intervalMs: 1000 });
    });

    scope.stop();

    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('goTo/next/previous clamp and wrap the index safely', () => {
    const scope = effectScope();
    scope.run(() => {
      const slideCount = ref(3);
      const { activeIndex, goTo, next, previous } = useCarouselAutoplay({ slideCount, intervalMs: 100000 });

      goTo(2);
      expect(activeIndex.value).toBe(2);
      next();
      expect(activeIndex.value).toBe(0);
      previous();
      expect(activeIndex.value).toBe(2);
    });
    scope.stop();
  });
});
