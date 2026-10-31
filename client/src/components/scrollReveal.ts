// Scroll reveal for [data-reveal] elements: one shared IntersectionObserver, plus a
// MutationObserver so elements React mounts later (day switch, new expenses) are picked up.
// Marks use a data attribute instead of a class so React className updates never clear them.

const STAGGER_MS = 50;
const MAX_STAGGER = 8;

export function startScrollReveal(root: HTMLElement = document.body): () => void {
  if (typeof IntersectionObserver === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};

  const html = document.documentElement;
  html.classList.add('reveal-on');

  const io = new IntersectionObserver(
    (entries) => {
      let k = 0;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        io.unobserve(el);
        el.style.setProperty('--reveal-delay', k < MAX_STAGGER ? `${k * STAGGER_MS}ms` : '0ms');
        el.setAttribute('data-shown', '');
        k += 1;
      }
    },
    { rootMargin: '0px 0px -4% 0px', threshold: 0.05 },
  );

  const watch = (node: Element) => {
    if (node.matches('[data-reveal]:not([data-shown])')) io.observe(node);
    node.querySelectorAll('[data-reveal]:not([data-shown])').forEach((el) => io.observe(el));
  };
  watch(root);

  const mo = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node instanceof Element) watch(node);
      });
    }
  });
  mo.observe(root, { childList: true, subtree: true });

  return () => {
    mo.disconnect();
    io.disconnect();
    html.classList.remove('reveal-on');
  };
}
