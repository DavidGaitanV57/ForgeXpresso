/* eslint-disable @next/next/no-img-element, @next/next/no-html-link-for-pages -- static screenshots; /studio must be a full navigation so its stylesheet stays isolated */
import type { Metadata } from "next";
import { LANDING } from "@/lib/i18n-landing";
import LandingClient from "./landing-client";
import "./landing.css";

const L = LANDING.es;

export const metadata: Metadata = {
  title: L["landing.title"],
  description: L["landing.desc"],
};

const PLAY = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5v14l11-7z" />
  </svg>
);

function Cta({ short = false }: { short?: boolean }) {
  return (
    <a className={`btn primary${short ? " sm" : ""}`} href="/studio">
      {PLAY}
      {short ? (
        <>
          <span className="cta-full" data-i18n="landing.cta">{L["landing.cta"]}</span>
          <span className="cta-short" data-i18n="landing.ctaShort">{L["landing.ctaShort"]}</span>
        </>
      ) : (
        <span data-i18n="landing.cta">{L["landing.cta"]}</span>
      )}
    </a>
  );
}

/** Screenshot that follows the page locale; `other` shows the next locale instead (language showcase). */
function Shot({ name, cap, alt, eager, other }: { name: string; cap: string; alt?: string; eager?: boolean; other?: boolean }) {
  const altKey = alt ?? cap;
  return (
    <button type="button" className="shot" data-cap={cap} data-i18n-aria="landing.zoom" aria-label={L["landing.zoom"]}>
      <img
        src={`/landing/${other ? "en" : "es"}/${name}.webp`}
        data-shot={name}
        data-other={other ? "" : undefined}
        data-i18n-alt={altKey}
        alt={L[altKey]}
        width={1440}
        height={900}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={eager ? "high" : undefined}
      />
    </button>
  );
}

const T = ({ k }: { k: string }) => <span data-i18n={k}>{L[k]}</span>;

const FACTS = ["f1", "f2", "f3", "f4"];
const GAMES = [
  { id: "g1", shot: "play-2d", c: "#60a5fa" },
  { id: "g2", shot: "play", c: "#10b981" },
  { id: "g3", shot: "play-3d", c: "#8b5cf6" },
];
const STEPS = [
  { id: "s1", shot: "lobby" },
  { id: "s2", shot: "studio-25d" },
  { id: "s3", shot: "chat" },
  { id: "s4", shot: "studio-2d" },
  { id: "s5", shot: "export" },
];
const TOOLS = [
  { id: "t1", shot: "viewer" },
  { id: "t2", shot: "library" },
  { id: "t3", shot: "cinematic" },
  { id: "t4", shot: "tour" },
  { id: "t5", shot: "pro" },
  { id: "t6", shot: "lobby", other: true },
];

export default function Landing() {
  return (
    <div className="ld" id="landing">
      <a className="skip" href="#main" data-i18n="landing.skip">{L["landing.skip"]}</a>

      <header className="ld-top" id="ldTop">
        <div className="wrap ld-top-in">
          <a className="brand" href="/" aria-label="Forge Xpresso">
            <img src="/brand/forgy.png" alt="" width={30} height={30} />
            forge <span>Xpresso</span>
          </a>
          <nav className="ld-nav" data-i18n-aria="landing.menu" aria-label={L["landing.menu"]}>
            <a href="#games" data-i18n="landing.nav.games">{L["landing.nav.games"]}</a>
            <a href="#how" data-i18n="landing.nav.how">{L["landing.nav.how"]}</a>
            <a href="#tools" data-i18n="landing.nav.tools">{L["landing.nav.tools"]}</a>
          </nav>
          <span className="sp" />
          <div className="langsw" id="ldLang" role="group" aria-label="Idioma · Language · Langue">
            {(["es", "en", "fr"] as const).map((l) => (
              <button key={l} type="button" data-locale={l} className={l === "es" ? "on" : ""} aria-pressed={l === "es"}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <Cta short />
        </div>
      </header>

      <main id="main">
        <section className="wrap hero">
          <div>
            <div className="eyebrow"><T k="landing.hero.eyebrow" /></div>
            <h1 data-i18n-html="landing.hero.h1" dangerouslySetInnerHTML={{ __html: L["landing.hero.h1"] }} />
            <p className="lead"><T k="landing.hero.lead" /></p>
            <div className="cta">
              <Cta />
              <a className="btn" href="#how"><T k="landing.hero.how" /></a>
            </div>
            <p className="note"><T k="landing.hero.note" /></p>
          </div>
          <Shot name="studio-3d" cap="landing.hero.cap" alt="landing.hero.alt" eager />
        </section>

        <div className="wrap">
          <dl className="facts rv" data-i18n-aria="landing.facts.aria" aria-label={L["landing.facts.aria"]}>
            {FACTS.map((f) => (
              <div key={f}>
                <dt><T k={`landing.${f}.k`} /></dt>
                <dd>
                  <b><T k={`landing.${f}.b`} /></b>
                  <span data-i18n={`landing.${f}.s`}>{L[`landing.${f}.s`]}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <section id="games">
          <div className="wrap">
            <div className="rv">
              <div className="eyebrow"><T k="landing.games.eyebrow" /></div>
              <h2><T k="landing.games.h2" /></h2>
              <p className="lead"><T k="landing.games.lead" /></p>
            </div>
            <div className="games">
              {GAMES.map((g) => (
                <article className="game rv" key={g.id}>
                  <Shot name={g.shot} cap={`landing.${g.id}.s`} alt={`landing.${g.id}.b`} />
                  <div className="game-meta">
                    <span className="dim-tag" style={{ "--c": g.c } as React.CSSProperties}>{L[`landing.${g.id}.tag`]}</span>
                    <h3><T k={`landing.${g.id}.b`} /></h3>
                  </div>
                  <p><T k={`landing.${g.id}.s`} /></p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how">
          <div className="wrap">
            <div className="rv">
              <div className="eyebrow"><T k="landing.how.eyebrow" /></div>
              <h2><T k="landing.how.h2" /></h2>
              <p className="lead"><T k="landing.how.lead" /></p>
            </div>
            <div className="journey">
              {STEPS.map((s, i) => (
                <article className="step rv" key={s.id}>
                  <div className="txt">
                    <span className="num">{i + 1}</span>
                    <h3><T k={`landing.${s.id}.h`} /></h3>
                    <p><T k={`landing.${s.id}.p`} /></p>
                    <ul>
                      {["l1", "l2", "l3"].map((l) => (
                        <li key={l}><T k={`landing.${s.id}.${l}`} /></li>
                      ))}
                    </ul>
                  </div>
                  <Shot name={s.shot} cap={`landing.${s.id}.cap`} />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="tools">
          <div className="wrap">
            <div className="rv">
              <div className="eyebrow"><T k="landing.tools.eyebrow" /></div>
              <h2><T k="landing.tools.h2" /></h2>
              <p className="lead"><T k="landing.tools.lead" /></p>
            </div>
            <div className="gal">
              {TOOLS.map((t) => (
                <figure className="rv" key={t.id}>
                  <Shot name={t.shot} cap={`landing.${t.id}.cap`} other={t.other} />
                  <figcaption>
                    <b><T k={`landing.${t.id}.b`} /></b>
                    <span data-i18n={`landing.${t.id}.s`}>{L[`landing.${t.id}.s`]}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section className="wrap end rv">
          <img src="/brand/forgy.png" alt="" width={112} height={112} />
          <h2><T k="landing.end.h2" /></h2>
          <p className="lead"><T k="landing.end.p" /></p>
          <div className="cta"><Cta /></div>
        </section>
      </main>

      <footer className="ld-foot">
        <div className="wrap">
          <span><T k="landing.foot.l" /> · © 2026</span>
          <span><T k="landing.foot.r" /></span>
        </div>
      </footer>

      <div className="lb" id="ldLb" hidden role="dialog" aria-modal="true" data-i18n-aria="landing.lb.aria" aria-label={L["landing.lb.aria"]}>
        <button type="button" id="ldLbX" data-i18n-aria="landing.lb.close" aria-label={L["landing.lb.close"]}>×</button>
        <figure>
          <img id="ldLbImg" alt="" />
          <figcaption id="ldLbCap" />
        </figure>
      </div>

      <LandingClient />
    </div>
  );
}
