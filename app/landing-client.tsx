"use client";

import { useEffect } from "react";
import { applyDomI18n, initLocale, setLocale, t, type Locale } from "@/lib/i18n";

const NEXT_LOCALE: Record<Locale, Locale> = { es: "en", en: "fr", fr: "es" };

function applyLocale(loc: Locale) {
  setLocale(loc);
  const root = document.getElementById("landing");
  if (!root) return;
  applyDomI18n(root);
  root.querySelectorAll<HTMLImageElement>("img[data-shot]").forEach((img) => {
    const src = `/landing/${img.hasAttribute("data-other") ? NEXT_LOCALE[loc] : loc}/${img.dataset.shot}.webp`;
    if (img.getAttribute("src") !== src) img.src = src;
    const altKey = img.dataset.i18nAlt;
    if (altKey) img.alt = t(altKey);
  });
  root.querySelectorAll<HTMLButtonElement>("#ldLang [data-locale]").forEach((b) => {
    const on = b.dataset.locale === loc;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  });
  document.title = t("landing.title");
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("landing.desc"));
}

/** Locale, lightbox, sticky-header and scroll-reveal behavior for the server-rendered landing. */
export default function LandingClient() {
  useEffect(() => {
    const root = document.getElementById("landing");
    if (!root) return;
    const off: (() => void)[] = [];
    const on = (el: EventTarget, type: string, fn: (e: Event) => void) => {
      el.addEventListener(type, fn);
      off.push(() => el.removeEventListener(type, fn));
    };

    const loc = initLocale();
    if (loc !== "es") applyLocale(loc);
    else setLocale(loc);

    // Next streams the <title> in after hydration; keep it in the active locale.
    const keepTitle = new MutationObserver(() => {
      const want = t("landing.title");
      if (document.title !== want) document.title = want;
    });
    keepTitle.observe(document.head, { childList: true, subtree: true, characterData: true });
    off.push(() => keepTitle.disconnect());

    root.querySelectorAll<HTMLButtonElement>("#ldLang [data-locale]").forEach((b) =>
      on(b, "click", () => applyLocale(b.dataset.locale as Locale)),
    );

    const top = document.getElementById("ldTop");
    const onScroll = () => top?.classList.toggle("scrolled", window.scrollY > 8);
    onScroll();
    on(window, "scroll", onScroll);

    const lb = document.getElementById("ldLb")!;
    const lbImg = document.getElementById("ldLbImg") as HTMLImageElement;
    const lbCap = document.getElementById("ldLbCap")!;
    const lbX = document.getElementById("ldLbX")!;
    let opener: HTMLElement | null = null;
    const close = () => {
      lb.hidden = true;
      document.body.style.overflow = "";
      opener?.focus();
    };
    root.querySelectorAll<HTMLButtonElement>(".shot").forEach((b) =>
      on(b, "click", () => {
        const img = b.querySelector("img");
        if (!img) return;
        lbImg.src = img.currentSrc || img.src;
        lbImg.alt = img.alt;
        lbCap.textContent = b.dataset.cap ? t(b.dataset.cap) : "";
        lb.hidden = false;
        document.body.style.overflow = "hidden";
        opener = b;
        lbX.focus();
      }),
    );
    on(lbX, "click", close);
    on(lb, "click", (e) => {
      if (e.target === lb || (e.target as HTMLElement).tagName === "FIGURE") close();
    });
    on(document, "keydown", (e) => {
      const k = e as KeyboardEvent;
      if (lb.hidden) return;
      if (k.key === "Escape") close();
      else if (k.key === "Tab") {
        k.preventDefault();
        lbX.focus();
      }
    });

    // Only content below the fold animates in, so nothing visible on load flickers.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced && "IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) =>
          entries.forEach((en) => {
            if (en.isIntersecting) {
              en.target.classList.remove("pending");
              io.unobserve(en.target);
            }
          }),
        { rootMargin: "0px 0px -8% 0px" },
      );
      root.querySelectorAll<HTMLElement>(".rv").forEach((el) => {
        if (el.getBoundingClientRect().top > window.innerHeight) {
          el.classList.add("pending");
          io.observe(el);
        }
      });
      off.push(() => io.disconnect());
    }

    return () => off.forEach((f) => f());
  }, []);

  return null;
}
